import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { GAME_CONFIG, GAMES } from "@/lib/games";
import {
  MIN_TOURNAMENT_LOBBY,
  planDuoTournamentLobbies,
  planTournamentLobbies,
} from "@/lib/lobbies";
import {
  isHeadToHead,
  MATCH_MODES,
  maxSlotsFor,
  MODE_LABEL,
  MODES_FOR_GAME,
  playersPerSlot,
} from "@/lib/match-schema";
import { rupeesToPaise } from "@/lib/money";
import { assertAdmin, type Actor } from "@/lib/roles";
import { addMinutes, istInputToUtc } from "@/lib/time";
import {
  bracketPodium,
  bracketShape,
  mondayOfIstWeek,
  nextRoundEntrants,
  pairRound,
  roundName,
  type BracketMatchResult,
} from "@/lib/tournament";
import { applyTransition } from "./match-status";
import { cancelMatch } from "./matches";
import { notify, type NotificationEvent } from "./notify";
import { executeRefunds, markRefund } from "./payments";
import { bracketState, lobbyStandingsFor, unitOf } from "./tournament-queries";

const CLOSE_OFFSET_MIN = 30;
/** Gap before a next-round bracket match (after the later feeder match started). */
const NEXT_ROUND_GAP_MIN = 90;

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v === "" ? "0" : v);
  if (p === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount in rupees" });
    return z.NEVER;
  }
  return p;
});

const istDateTime = z.string().transform((v, ctx) => {
  const d = istInputToUtc(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Pick a date and time" });
    return z.NEVER;
  }
  return d;
});

const httpsOrEmpty = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https:\/\//.test(v), "Use a full https:// link");

export const tournamentFormSchema = z
  .object({
    game: z.enum(GAMES),
    mode: z.enum(MATCH_MODES),
    title: z.string().trim().min(3).max(80),
    startsAt: istDateTime,
    prizePool: money,
    /** Paid at sign-up (the sign-up list carries it); 0 = free. Refunded if the tournament is cancelled. */
    entryFee: money.default(0),
    rulesMarkdown: z.string().max(20_000).default(""),
    streamUrl: httpsOrEmpty,
  })
  .superRefine((v, ctx) => {
    if (!MODES_FOR_GAME[v.game].includes(v.mode)) {
      ctx.addIssue({
        code: "custom",
        path: ["mode"],
        message: "This mode is not available for the chosen game",
      });
    }
  });

async function loadTournament(tx: Tx, id: string) {
  const t = await tx.tournament.findUnique({ where: { id } });
  if (!t) throw new AppError("NOT_FOUND", "Tournament not found.");
  return t;
}

async function loadOpenTournament(tx: Tx, id: string) {
  const t = await loadTournament(tx, id);
  if (t.cancelledAt) throw new AppError("CONFLICT", "This tournament is cancelled.");
  return t;
}

/** Create the weekly tournament and its sign-up list (registration opens immediately). */
export async function createTournament(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const v = parseInput(tournamentFormSchema, input);
  const format = isHeadToHead(v.mode) ? "BRACKET" : "LOBBY_POINTS";
  // Sign-ups are uncapped (DECISIONS M50); maxSlots is one lobby (or one game) for display.
  const slots = maxSlotsFor(v.game, v.mode);
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.tournament.create({
        data: {
          game: v.game,
          title: v.title,
          weekOf: mondayOfIstWeek(v.startsAt),
          startsAt: v.startsAt,
          prizePoolPaise: v.prizePool,
          rulesMarkdown: v.rulesMarkdown,
          format,
          mode: v.mode,
          bracketSize: null,
          streamUrl: v.streamUrl,
        },
      });
      const entry = await tx.match.create({
        data: {
          game: v.game,
          kind: "TOURNAMENT",
          mode: v.mode,
          title: `${v.title} — sign-up`,
          description: "Tournament sign-up list. Register here.",
          startsAt: v.startsAt,
          registrationClosesAt: addMinutes(v.startsAt, -CLOSE_OFFSET_MIN),
          maxSlots: slots,
          // The fee is paid when signing up (the lobby/bracket matches copy entries, never charge again).
          entryFeePaise: v.entryFee,
          status: "REGISTRATION_OPEN",
          isEntryList: true,
          tournamentId: t.id,
          createdById: me.id,
        },
      });
      const saved = await tx.tournament.update({
        where: { id: t.id },
        data: { entryMatchId: entry.id },
      });
      await writeAudit(tx, {
        actorId: me.id,
        action: "tournament.create",
        entityType: "Tournament",
        entityId: t.id,
        after: saved,
      });
      return saved;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        `There is already a ${GAME_CONFIG[v.game].name} ${MODE_LABEL[v.mode]} tournament that week.`,
      );
    }
    throw e;
  }
}

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const updateSchema = z.object({
  tournamentId: z.string().min(1),
  title: z.string().trim().min(3).max(80),
  prizePool: money,
  /** Only while nobody has signed up (players already paid or agreed to the old fee). */
  entryFee: z.preprocess(blankToUndefined, money.optional()),
  rulesMarkdown: z.string().max(20_000),
  streamUrl: httpsOrEmpty,
  /** Structure: only while nobody has signed up and no lobby/bracket match exists. */
  startsAt: z.preprocess(blankToUndefined, istDateTime.optional()),
  mode: z.preprocess(blankToUndefined, z.enum(MATCH_MODES).optional()),
});

type TournamentRow = Awaited<ReturnType<typeof loadTournament>>;

/** New structure (start, mode) if the input changes it, validated like createTournament. */
async function structureChange(tx: Tx, t: TournamentRow, v: z.infer<typeof updateSchema>) {
  const entry = t.entryMatchId
    ? await tx.match.findUnique({ where: { id: t.entryMatchId } })
    : null;
  const mode = v.mode ?? t.mode;
  const startsAt = v.startsAt ?? t.startsAt;
  const format = isHeadToHead(mode) ? ("BRACKET" as const) : ("LOBBY_POINTS" as const);
  const changed = startsAt.getTime() !== t.startsAt.getTime() || mode !== t.mode;
  if (!changed) return null;

  if (t.cancelledAt) throw new AppError("CONFLICT", "This tournament is cancelled.");
  const [signedUp, matches] = await Promise.all([
    entry
      ? tx.registration.count({ where: { matchId: entry.id, status: { not: "CANCELLED" } } })
      : 0,
    tx.match.count({ where: { tournamentId: t.id, isEntryList: false } }),
  ]);
  if (signedUp || matches) {
    throw new AppError(
      "CONFLICT",
      "Start time and mode can only change while nobody has signed up and no matches exist.",
    );
  }
  if (!MODES_FOR_GAME[t.game].includes(mode))
    throw new AppError("VALIDATION", "This mode is not available for this game.", {
      mode: ["Not available for this game"],
    });
  return { entry, mode, startsAt, format, slots: maxSlotsFor(t.game, mode) };
}

/** New entry fee (paise) if it changes; refused once anyone has signed up. Null = unchanged. */
async function entryFeeChange(tx: Tx, t: TournamentRow, fee: number | undefined) {
  if (fee === undefined || !t.entryMatchId) return null;
  const entry = await tx.match.findUniqueOrThrow({ where: { id: t.entryMatchId } });
  if (entry.entryFeePaise === fee) return null;
  if (t.cancelledAt) throw new AppError("CONFLICT", "This tournament is cancelled.");
  const signedUp = await tx.registration.count({
    where: { matchId: entry.id, status: { not: "CANCELLED" } },
  });
  if (signedUp) {
    throw new AppError("CONFLICT", "The entry fee can only change while nobody has signed up.", {
      entryFee: ["Players have already signed up"],
    });
  }
  return fee;
}

export async function updateTournament(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const v = parseInput(updateSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      const before = await loadTournament(tx, v.tournamentId);
      const change = await structureChange(tx, before, v);
      const entryFeePaise = await entryFeeChange(tx, before, v.entryFee);
      const after = await tx.tournament.update({
        where: { id: v.tournamentId },
        data: {
          title: v.title,
          prizePoolPaise: v.prizePool,
          rulesMarkdown: v.rulesMarkdown,
          streamUrl: v.streamUrl,
          ...(change
            ? {
                startsAt: change.startsAt,
                weekOf: mondayOfIstWeek(change.startsAt),
                mode: change.mode,
                format: change.format,
                bracketSize: null,
              }
            : {}),
        },
      });
      // Keep the sign-up list in sync with the tournament.
      if (before.entryMatchId) {
        await tx.match.update({
          where: { id: before.entryMatchId },
          data: {
            title: `${v.title} — sign-up`,
            ...(entryFeePaise === null ? {} : { entryFeePaise }),
            ...(change
              ? {
                  startsAt: change.startsAt,
                  registrationClosesAt: addMinutes(change.startsAt, -CLOSE_OFFSET_MIN),
                  mode: change.mode,
                  maxSlots: change.slots,
                }
              : {}),
          },
        });
      }
      await writeAudit(tx, {
        actorId: me.id,
        action: "tournament.update",
        entityType: "Tournament",
        entityId: v.tournamentId,
        before,
        after,
      });
      return after;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "There is already a tournament for this game and mode that week.",
      );
    }
    throw e;
  }
}

const cancelTournamentSchema = z.object({
  tournamentId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(250),
});

/**
 * Cancel a tournament: mark it cancelled, then cancel (and refund) every match that has not
 * finished, the sign-up list included, through the regular cancelMatch service. Safe to retry.
 */
export async function cancelTournament(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId, reason } = parseInput(cancelTournamentSchema, input);
  const open = await db.$transaction(async (tx) => {
    const before = await loadTournament(tx, tournamentId);
    if (before.winnersPublishedAt)
      throw new AppError("CONFLICT", "Winners are already published; it cannot be cancelled.");
    const matches = await tx.match.findMany({
      where: { tournamentId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true, title: true, status: true },
    });
    const waiting = matches.find((m) => m.status === "RESULTS_PENDING");
    if (waiting)
      throw new AppError(
        "CONFLICT",
        `“${waiting.title}” is waiting for results. Approve its results first, then cancel.`,
      );
    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: before.cancelledAt ? {} : { cancelledAt: new Date(), cancelReason: reason },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.cancel",
      entityType: "Tournament",
      entityId: tournamentId,
      before: { cancelledAt: before.cancelledAt, cancelReason: before.cancelReason },
      after: {
        cancelledAt: after.cancelledAt,
        cancelReason: after.cancelReason,
        reason,
        matchIds: matches.map((m) => m.id),
      },
    });
    return matches;
  });
  let refundsQueued = 0;
  for (const m of open) {
    const r = await cancelMatch(me, { matchId: m.id, reason: `Tournament cancelled: ${reason}` });
    refundsQueued += r.refundsQueued;
  }
  return { cancelledMatches: open.length, refundsQueued };
}

const lobbySchema = z.object({
  tournamentId: z.string().min(1),
  count: z.coerce.number().int().min(1).max(10),
  firstStartsAt: istDateTime,
  gapMinutes: z.coerce.number().int().min(15).max(240).default(45),
});

/**
 * Lobby-points tournaments: add N matches (rounds) spaced `gapMinutes` apart. Added after
 * registration closed, they are split into the same lobbies straight away.
 */
export async function addLobbyMatches(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const v = parseInput(lobbySchema, input);
  return db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, v.tournamentId);
    if (t.format !== "LOBBY_POINTS")
      throw new AppError("VALIDATION", "Lobby matches are for solo, duo and squad tournaments.");
    const existing = await tx.match.count({ where: roundWhere(t.id) });
    const created = [];
    for (let i = 0; i < v.count; i++) {
      const startsAt = addMinutes(v.firstStartsAt, i * v.gapMinutes);
      created.push(await createRoundMatch(tx, t, existing + i + 1, startsAt, me.id));
    }
    const entry = await tx.match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    if (entry.status === "REGISTRATION_CLOSED") await distributeLobbies(tx, t, me.id);
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.addMatches",
      entityType: "Tournament",
      entityId: t.id,
      after: { matchIds: created.map((m) => m.id) },
    });
    return created;
  });
}

const NOT_STARTED = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"] as const;

/** A lobby tournament's matches (rounds): lobby 1 of each; extra lobbies point back at it. */
function roundWhere(tournamentId: string) {
  return { tournamentId, isEntryList: false, parentMatchId: null, bracketRound: null };
}

type TournamentInfo = Pick<
  TournamentRow,
  "id" | "game" | "mode" | "title" | "streamUrl" | "startsAt" | "entryMatchId" | "format"
>;

async function createRoundMatch(
  tx: Tx,
  t: TournamentInfo,
  number: number,
  startsAt: Date,
  createdById: string,
) {
  return tx.match.create({
    data: {
      game: t.game,
      kind: "TOURNAMENT",
      mode: t.mode,
      title: `${t.title} — Match ${number}`,
      startsAt,
      registrationClosesAt: addMinutes(startsAt, -CLOSE_OFFSET_MIN),
      maxSlots: maxSlotsFor(t.game, t.mode),
      // Filled from the sign-up list, never by registration: no minimum to cancel on.
      minSlots: 0,
      status: "UPCOMING",
      tournamentId: t.id,
      streamUrl: t.streamUrl,
      createdById,
    },
  });
}

/** Close the sign-up list (squads that never fully confirmed are dropped). */
async function closeEntryList(tx: Tx, entryId: string, actorId: string | null) {
  const entry = await tx.match.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.status === "UPCOMING")
    await applyTransition(tx, entryId, "UPCOMING", "REGISTRATION_OPEN", { actorId });
  if (entry.status === "UPCOMING" || entry.status === "REGISTRATION_OPEN") {
    await applyTransition(tx, entryId, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", { actorId });
  }
}

/** Confirmed sign-ups in sign-up order, with their rosters. */
function confirmedEntries(tx: Tx, entryId: string) {
  return tx.registration.findMany({
    where: { matchId: entryId, status: "CONFIRMED" },
    orderBy: { position: "asc" },
    include: { members: { where: { status: "CONFIRMED" } } },
  });
}

type EntryRegistration = Awaited<ReturnType<typeof confirmedEntries>>[number];

/** Copy a confirmed entry (and its roster) into a match as a CONFIRMED registration. */
async function copyEntry(tx: Tx, entry: EntryRegistration, matchId: string, position: number) {
  const reg = await tx.registration.create({
    data: {
      matchId,
      userId: entry.userId,
      teamId: entry.teamId,
      teamName: entry.teamName,
      status: "CONFIRMED",
      position,
    },
  });
  if (entry.members.length) {
    await tx.registrationMember.createMany({
      data: entry.members.map((m) => ({
        registrationId: reg.id,
        matchId,
        userId: m.userId,
        gameId: m.gameId,
        ign: m.ign,
        status: "CONFIRMED" as const,
        respondedAt: new Date(),
      })),
    });
  }
  return reg;
}

/** Everyone who plays under an entry: the registrant and roster players with accounts. */
function playersOfEntry(entry: EntryRegistration): string[] {
  return [
    ...new Set([entry.userId, ...entry.members.flatMap((m) => (m.userId ? [m.userId] : []))]),
  ];
}

type Refund = NonNullable<Awaited<ReturnType<typeof markRefund>>>;

export interface EntriesClosed {
  /** Notifications to send after commit. */
  events: NotificationEvent[];
  /** Refunds to execute after commit (entries left without a lobby). */
  refunds: Refund[];
}

/**
 * Lobby tournaments (DECISIONS M50): split the confirmed entries into balanced lobbies of at most
 * one lobby's capacity, the same lobby in every match (round). Each round's match becomes lobby 1;
 * each extra lobby is its own match (room, results) pointing back at it. Entries that fit no lobby
 * are removed and refunded. Rounds already split are left alone, so this is safe to rerun.
 */
async function distributeLobbies(
  tx: Tx,
  t: TournamentInfo,
  actorId: string | null,
): Promise<EntriesClosed> {
  const out: EntriesClosed = { events: [], refunds: [] };
  const entries = await confirmedEntries(tx, t.entryMatchId!);
  if (!entries.length) return out;
  let rounds = await tx.match.findMany({ where: roundWhere(t.id), orderBy: { startsAt: "asc" } });
  if (!rounds.length) {
    const entry = await tx.match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    rounds = [await createRoundMatch(tx, t, 1, t.startsAt, actorId ?? entry.createdById)];
  }
  const firstSplit = rounds.every((r) => r.lobbyNumber === null);
  const capacity = maxSlotsFor(t.game, t.mode);
  const minSize = Math.ceil(MIN_TOURNAMENT_LOBBY / playersPerSlot(t.game, t.mode));
  const plan =
    t.mode === "DUO"
      ? planDuoTournamentLobbies(entries.length, capacity, minSize)
      : planTournamentLobbies(entries.length, capacity, minSize);
  const groups: EntryRegistration[][] = [];
  let next = 0;
  for (const size of plan.sizes) {
    groups.push(entries.slice(next, next + size));
    next += size;
  }

  for (const round of rounds) {
    if (round.lobbyNumber !== null || !(NOT_STARTED as readonly string[]).includes(round.status))
      continue;
    const many = groups.length > 1;
    await tx.match.update({
      where: { id: round.id },
      data: { lobbyNumber: 1, ...(many ? { title: `${round.title} — Lobby 1` } : {}) },
    });
    for (const [i, group] of groups.entries()) {
      const lobby =
        i === 0
          ? round
          : await tx.match.create({
              data: {
                game: round.game,
                kind: round.kind,
                mode: round.mode,
                title: `${round.title} — Lobby ${i + 1}`,
                startsAt: round.startsAt,
                registrationClosesAt: round.registrationClosesAt,
                maxSlots: capacity,
                minSlots: 0,
                status: "REGISTRATION_CLOSED",
                tournamentId: t.id,
                streamUrl: round.streamUrl,
                parentMatchId: round.id,
                lobbyNumber: i + 1,
                createdById: round.createdById,
              },
            });
      for (const [pos, e] of group.entries()) await copyEntry(tx, e, lobby.id, pos + 1);
      if (firstSplit && round === rounds[0]) {
        out.events.push({
          type: "TOURNAMENT_LOBBY",
          userIds: group.flatMap(playersOfEntry),
          matchId: lobby.id,
          lobby: i + 1,
        });
      }
    }
    if (round.status === "UPCOMING")
      await applyTransition(tx, round.id, "UPCOMING", "REGISTRATION_OPEN", { actorId });
    if (round.status !== "REGISTRATION_CLOSED")
      await applyTransition(tx, round.id, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", { actorId });
  }

  const unplaced = firstSplit ? entries.slice(next) : [];
  for (const e of unplaced) {
    await tx.registration.update({
      where: { id: e.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    const refund = e.paymentId ? await markRefund(tx, e.paymentId, "Every lobby was full") : null;
    if (refund) out.refunds.push(refund);
  }
  if (unplaced.length) {
    out.events.push({
      type: "TOURNAMENT_UNPLACED",
      userIds: unplaced.flatMap(playersOfEntry),
      matchId: t.entryMatchId!,
    });
  }
  await writeAudit(tx, {
    actorId,
    action: "tournament.lobbies",
    entityType: "Tournament",
    entityId: t.id,
    after: { entries: entries.length, lobbies: plan.sizes, unplaced: unplaced.length },
  });
  return out;
}

/** Bracket match title: "Final", or "Semifinals, game 2". */
function bracketTitle(t: TournamentInfo, round: number, index: number, totalRounds: number) {
  const name = roundName(round, totalRounds);
  return `${t.title} — ${name}${round < totalRounds ? `, game ${index + 1}` : ""}`;
}

/** Create one bracket round: a 2-side match per pair of entrants (sign-up entries by unit key). */
async function createBracketRound(
  tx: Tx,
  t: TournamentInfo,
  round: number,
  entrants: string[],
  entries: EntryRegistration[],
  startsAt: Date,
  createdById: string,
) {
  const byUnit = new Map(entries.map((e) => [unitOf(e), e]));
  const totalRounds = bracketShape(entries.length).length;
  const created = [];
  for (const [index, pair] of pairRound(entrants).pairs.entries()) {
    const m = await tx.match.create({
      data: {
        game: t.game,
        kind: "TOURNAMENT",
        mode: t.mode,
        title: bracketTitle(t, round, index, totalRounds),
        startsAt,
        registrationClosesAt: addMinutes(startsAt, -CLOSE_OFFSET_MIN),
        maxSlots: 2,
        minSlots: 0,
        status: "REGISTRATION_CLOSED",
        tournamentId: t.id,
        bracketRound: round,
        bracketIndex: index,
        streamUrl: t.streamUrl,
        createdById,
      },
    });
    for (const [side, unit] of pair.entries())
      await copyEntry(tx, byUnit.get(unit)!, m.id, side + 1);
    created.push({ match: m, pair });
  }
  return created;
}

/**
 * Bracket tournaments (DECISIONS M50): round 1 pairs the confirmed entries in sign-up order
 * (1 v 2, 3 v 4, …); with an odd count the last one gets a bye. Does nothing once drawn.
 */
async function drawBracket(
  tx: Tx,
  t: TournamentInfo,
  startsAt: Date,
  actorId: string | null,
): Promise<EntriesClosed> {
  const out: EntriesClosed = { events: [], refunds: [] };
  if (await tx.match.count({ where: { tournamentId: t.id, bracketRound: { not: null } } }))
    return out;
  const entries = await confirmedEntries(tx, t.entryMatchId!);
  if (entries.length < 2) return out;
  const entry = await tx.match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
  const created = await createBracketRound(
    tx,
    t,
    1,
    entries.map(unitOf),
    entries,
    startsAt,
    actorId ?? entry.createdById,
  );
  const byUnit = new Map(entries.map((e) => [unitOf(e), e]));
  for (const { match, pair } of created) {
    out.events.push({
      type: "BRACKET_READY",
      userIds: pair.flatMap((u) => playersOfEntry(byUnit.get(u)!)),
      matchId: match.id,
    });
  }
  const bye = pairRound(entries).bye;
  if (bye)
    out.events.push({ type: "BRACKET_READY", userIds: playersOfEntry(bye), matchId: entry.id });
  await writeAudit(tx, {
    actorId,
    action: "tournament.bracket",
    entityType: "Tournament",
    entityId: t.id,
    after: {
      entries: entries.length,
      round1: created.map((c) => c.match.id),
      bye: bye?.id ?? null,
    },
  });
  return out;
}

/**
 * Registration of a tournament sign-up list just closed (the status job, or an admin): split the
 * entries into lobbies or draw the bracket. Idempotent. Returns what to send after commit.
 */
export async function onEntriesClosed(
  tx: Tx,
  entryMatchId: string,
  actorId: string | null,
): Promise<EntriesClosed | null> {
  const t = await tx.tournament.findFirst({ where: { entryMatchId } });
  if (!t || t.cancelledAt) return null;
  return t.format === "BRACKET"
    ? drawBracket(tx, t, t.startsAt, actorId)
    : distributeLobbies(tx, t, actorId);
}

/** After commit: refunds, then notifications. */
export async function finishEntriesClosed(closed: EntriesClosed | null) {
  if (!closed) return;
  if (closed.refunds.length) await executeRefunds(closed.refunds);
  await Promise.all(closed.events.map(notify));
}

/** Admin fallback for lobby tournaments: close sign-ups now and split into lobbies. Idempotent. */
export async function lockEntries(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId } = parseInput(z.object({ tournamentId: z.string().min(1) }), input);
  const { closed, summary } = await db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, tournamentId);
    if (t.format !== "LOBBY_POINTS")
      throw new AppError("VALIDATION", "Use “Draw bracket” for bracket tournaments.");
    await closeEntryList(tx, t.entryMatchId!, me.id);
    const entries = await tx.registration.count({
      where: { matchId: t.entryMatchId!, status: "CONFIRMED" },
    });
    if (!entries) throw new AppError("CONFLICT", "No confirmed entries to enter.");
    const closed = await distributeLobbies(tx, t, me.id);
    const [rounds, lobbies] = await Promise.all([
      tx.match.count({ where: roundWhere(t.id) }),
      tx.match.count({ where: { tournamentId, isEntryList: false } }),
    ]);
    return { closed, summary: { teams: entries, matches: rounds, lobbies } };
  });
  await finishEntriesClosed(closed);
  return summary;
}

const bracketSchema = z.object({
  tournamentId: z.string().min(1),
  firstRoundStartsAt: istDateTime,
});

/** Admin fallback for bracket tournaments: close sign-ups now and draw round 1. */
export async function generateBracket(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId, firstRoundStartsAt } = parseInput(bracketSchema, input);
  const { closed, created } = await db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, tournamentId);
    if (t.format !== "BRACKET")
      throw new AppError("VALIDATION", "This tournament does not use a bracket.");
    if (await tx.match.count({ where: { tournamentId, bracketRound: { not: null } } })) {
      throw new AppError("CONFLICT", "The bracket has already been drawn.");
    }
    await closeEntryList(tx, t.entryMatchId!, me.id);
    const entries = await tx.registration.count({
      where: { matchId: t.entryMatchId!, status: "CONFIRMED" },
    });
    if (entries < 2)
      throw new AppError(
        "VALIDATION",
        `A bracket needs at least 2 confirmed entries (have ${entries}).`,
      );
    const closed = await drawBracket(tx, t, firstRoundStartsAt, me.id);
    const created = await tx.match.findMany({
      where: { tournamentId, bracketRound: 1 },
      orderBy: { bracketIndex: "asc" },
    });
    return { closed, created };
  });
  await finishEntriesClosed(closed);
  return created;
}

/**
 * Called inside the results-approval transaction: once every match of a bracket round is decided,
 * create the next round (last round's bye first, then the winners in match order).
 */
export async function advanceBracket(tx: Tx, matchId: string, actorId: string | null) {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { tournamentId: true, bracketRound: true, createdById: true },
  });
  if (!match.tournamentId || match.bracketRound === null) return null;
  const t = await loadTournament(tx, match.tournamentId);
  if (t.format !== "BRACKET" || !t.entryMatchId) return null;
  const state = await bracketState(tx, t.entryMatchId, t.id);
  const round = state.rounds[match.bracketRound - 1];
  if (!round?.complete) return null;
  const entrants = nextRoundEntrants(round.winners as string[], round.bye);
  if (entrants.length < 2) return null; // the final is decided
  const nextRound = round.round + 1;
  if (await tx.match.count({ where: { tournamentId: t.id, bracketRound: nextRound } })) return null;
  const latest = await tx.match.findFirstOrThrow({
    where: { tournamentId: t.id, bracketRound: round.round },
    orderBy: { startsAt: "desc" },
    select: { startsAt: true },
  });
  const entries = await confirmedEntries(tx, t.entryMatchId);
  const created = await createBracketRound(
    tx,
    t,
    nextRound,
    entrants,
    entries,
    addMinutes(latest.startsAt, NEXT_ROUND_GAP_MIN),
    actorId ?? match.createdById,
  );
  await writeAudit(tx, {
    actorId,
    action: "tournament.advance",
    entityType: "Tournament",
    entityId: t.id,
    after: { round: nextRound, entrants, matchIds: created.map((c) => c.match.id) },
  });
  return created.map((c) => c.match);
}

/**
 * Called inside the results-reopen transaction for a bracket match: undo advanceBracket by
 * removing the later rounds, which are rebuilt when the round is decided again. Refuses once a
 * later-round match has started.
 */
export async function rollbackBracketAdvance(tx: Tx, matchId: string) {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { tournamentId: true, bracketRound: true },
  });
  if (!match.tournamentId || match.bracketRound === null) return null;
  const later = await tx.match.findMany({
    where: { tournamentId: match.tournamentId, bracketRound: { gt: match.bracketRound } },
    select: { id: true, status: true },
  });
  if (!later.length) return null;
  if (later.some((m) => !(NOT_STARTED as readonly string[]).includes(m.status))) {
    throw new AppError(
      "CONFLICT",
      "The next-round match has already started. Reopen or cancel that match first.",
    );
  }
  const ids = later.map((m) => m.id);
  await tx.registrationMember.deleteMany({ where: { matchId: { in: ids } } });
  await tx.registration.deleteMany({ where: { matchId: { in: ids } } });
  await tx.match.deleteMany({ where: { id: { in: ids } } });
  return { deleted: ids };
}

/** Clear published winners (admin reopened a result of a published tournament). */
export async function unpublishWinners(tx: Tx, tournamentId: string) {
  const before = await tx.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { winners: true, winnersPublishedAt: true },
  });
  await tx.tournament.update({
    where: { id: tournamentId },
    data: { winners: Prisma.DbNull, winnersPublishedAt: null },
  });
  await tx.carouselItem.updateMany({ where: { tournamentId }, data: { active: false } });
  return before;
}

export interface PublishedWinner {
  place: number;
  name: string;
  avatarUrl: string | null;
  prizePaise: number;
  userIds: string[];
  /** Who receives the prize money: the team captain, or the solo player. */
  payeeUserId?: string;
}

/** Compute the podium (entries identified by their team or solo player). */
async function podium(
  tx: Tx,
  t: { id: string; format: "BRACKET" | "LOBBY_POINTS"; entryMatchId: string | null },
) {
  const unfinished = await tx.match.count({
    where: {
      tournamentId: t.id,
      isEntryList: false,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
  });
  if (unfinished)
    throw new AppError("CONFLICT", "Finish (approve results for) every tournament match first.");
  if (t.format === "LOBBY_POINTS") {
    const standings = await lobbyStandingsFor(tx, t.id);
    return standings.slice(0, 3).map((s) => s.unitKey);
  }
  const bracketMatches = await tx.match.findMany({
    where: { tournamentId: t.id, bracketRound: { not: null } },
    select: { id: true, bracketRound: true, bracketIndex: true },
  });
  const results: BracketMatchResult[] = [];
  for (const m of bracketMatches) {
    const rs = await tx.result.findMany({
      where: { matchId: m.id, approvedAt: { not: null } },
      include: { registration: { select: { teamId: true, userId: true } } },
    });
    const w = rs.find((r) => r.won);
    const l = rs.find((r) => !r.won);
    // Walkover: the side without a result (a no-show) is the loser.
    const noShow =
      w && !l
        ? await tx.registration.findFirst({
            where: { matchId: m.id, status: "NO_SHOW" },
            select: { teamId: true, userId: true },
          })
        : null;
    const loser = l?.registration ?? noShow;
    if (w && loser) {
      results.push({
        round: m.bracketRound!,
        index: m.bracketIndex!,
        winnerKey: w.registration.teamId ?? w.registration.userId,
        loserKey: loser.teamId ?? loser.userId,
        loserRoundDiff: l ? (l.roundDiff ?? 0) : -13,
      });
    }
  }
  const entries = await tx.registration.count({
    where: { matchId: t.entryMatchId ?? "", status: "CONFIRMED" },
  });
  return bracketPodium(results, bracketShape(entries).length);
}

const publishSchema = z.object({
  tournamentId: z.string().min(1),
  prizes: z.array(money).length(3),
});

/** Publish the top 3 with prizes; creates/refreshes the home carousel card for this tournament. */
export async function publishWinners(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId, prizes } = parseInput(publishSchema, input);
  let published: { title: string; winners: PublishedWinner[] } | null = null;
  const result = await db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, tournamentId);
    const keys = await podium(tx, t);
    if (!keys.length) throw new AppError("CONFLICT", "No results to publish yet.");
    const winners: PublishedWinner[] = [];
    for (const [i, key] of keys.entries()) {
      const team = await tx.team.findUnique({
        where: { id: key },
        include: { captain: { select: { avatarUrl: true } } },
      });
      if (team) {
        const reg = await tx.registration.findFirst({
          where: {
            teamId: team.id,
            match: { tournamentId: t.id, isEntryList: false },
            status: { in: ["CONFIRMED", "NO_SHOW"] },
          },
          include: { members: { where: { status: "CONFIRMED" }, select: { userId: true } } },
        });
        winners.push({
          place: i + 1,
          name: team.name,
          avatarUrl: team.captain.avatarUrl,
          prizePaise: prizes[i]!,
          userIds: reg?.members.flatMap((m) => (m.userId ? [m.userId] : [])) ?? [team.captainId],
          payeeUserId: team.captainId,
        });
      } else {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: key },
          select: { id: true, displayName: true, avatarUrl: true },
        });
        // A roster the captain entered by game ID: the team name he typed, and the players with accounts.
        const reg = await tx.registration.findFirst({
          where: {
            userId: user.id,
            teamName: { not: null },
            match: { tournamentId: t.id, isEntryList: false },
            status: { in: ["CONFIRMED", "NO_SHOW"] },
          },
          include: { members: { where: { status: "CONFIRMED" }, select: { userId: true } } },
        });
        winners.push({
          place: i + 1,
          name: reg?.teamName ?? user.displayName ?? "Player",
          avatarUrl: user.avatarUrl,
          prizePaise: prizes[i]!,
          userIds: reg
            ? [...new Set([user.id, ...reg.members.flatMap((m) => (m.userId ? [m.userId] : []))])]
            : [user.id],
          payeeUserId: user.id,
        });
      }
    }
    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        winners: winners as unknown as Prisma.InputJsonValue,
        winnersPublishedAt: new Date(),
      },
    });
    const slug = GAME_CONFIG[t.game].slug;
    const card = {
      game: t.game,
      title: `${winners[0]!.name} won ${t.title}`,
      subtitle:
        winners
          .slice(1)
          .map((w) => `${w.place === 2 ? "2nd" : "3rd"}: ${w.name}`)
          .join(" · ") || null,
      imageUrl: winners[0]!.avatarUrl,
      linkUrl: `/tournament/${slug}/past#${t.id}`,
      order: 0,
      active: true,
      tournamentId: t.id,
    };
    const existing = await tx.carouselItem.findFirst({ where: { tournamentId: t.id } });
    if (existing) await tx.carouselItem.update({ where: { id: existing.id }, data: card });
    else await tx.carouselItem.create({ data: card });
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.publishWinners",
      entityType: "Tournament",
      entityId: t.id,
      before: { winners: t.winners },
      after: { winners },
    });
    published = { title: t.title, winners };
    return after;
  });
  // Each prize's payee hears they won and when it's paid (DECISIONS M28).
  const done = published as { title: string; winners: PublishedWinner[] } | null;
  for (const w of done?.winners ?? []) {
    if (w.prizePaise <= 0 || !w.payeeUserId) continue;
    await notify({
      type: "PRIZE_WON",
      userIds: [w.payeeUserId],
      amountPaise: w.prizePaise,
      place: w.place,
      eventTitle: done!.title,
    });
  }
  return result;
}
