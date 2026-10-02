import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { GAME_CONFIG, GAMES, type Game } from "@/lib/games";
import {
  isHeadToHead,
  MATCH_MODES,
  maxSlotsFor,
  MODE_LABEL,
  MODES_FOR_GAME,
  type MatchMode,
} from "@/lib/match-schema";
import { rupeesToPaise } from "@/lib/money";
import { assertAdmin, type Actor } from "@/lib/roles";
import { addMinutes, istInputToUtc } from "@/lib/time";
import {
  bracketPodium,
  firstRoundPairs,
  isBracketSize,
  mondayOfIstWeek,
  nextSlot,
  roundCount,
  roundName,
  siblingIndex,
  type BracketMatchResult,
  type BracketSize,
} from "@/lib/tournament";
import { applyTransition } from "./match-status";
import { cancelMatch } from "./matches";
import { notify } from "./notify";
import { lobbyStandingsFor } from "./tournament-queries";

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
    bracketSize: z.coerce.number().int().optional(),
    streamUrl: httpsOrEmpty,
  })
  .superRefine((v, ctx) => {
    if (!MODES_FOR_GAME[v.game].includes(v.mode)) {
      ctx.addIssue({
        code: "custom",
        path: ["mode"],
        message: "This mode is not available for the chosen game",
      });
    } else if (isHeadToHead(v.mode)) {
      if (!v.bracketSize || !isBracketSize(v.bracketSize))
        ctx.addIssue({ code: "custom", path: ["bracketSize"], message: "Choose 8 or 16 entries" });
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
  // Lobby tournaments take a full lobby (no max field); brackets take exactly 8 or 16.
  const slots = format === "BRACKET" ? v.bracketSize! : maxSlotsFor(v.game, v.mode);
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
          bracketSize: format === "BRACKET" ? v.bracketSize : null,
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
  bracketSize: z.preprocess(blankToUndefined, z.coerce.number().int().optional()),
});

type TournamentRow = Awaited<ReturnType<typeof loadTournament>>;

/** New structure (start, mode, size) if the input changes it, validated like createTournament. */
async function structureChange(
  tx: Tx,
  t: TournamentRow,
  v: z.infer<typeof updateSchema>,
) {
  const entry = t.entryMatchId
    ? await tx.match.findUnique({ where: { id: t.entryMatchId } })
    : null;
  const mode = v.mode ?? t.mode;
  const startsAt = v.startsAt ?? t.startsAt;
  const format = isHeadToHead(mode) ? ("BRACKET" as const) : ("LOBBY_POINTS" as const);
  const size =
    format === "BRACKET"
      ? (v.bracketSize ?? (t.format === "BRACKET" ? t.bracketSize : null))
      : maxSlotsFor(t.game, mode);
  const changed =
    startsAt.getTime() !== t.startsAt.getTime() ||
    mode !== t.mode ||
    (format === "BRACKET" ? size !== t.bracketSize : size !== entry?.maxSlots);
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
      "Start time, mode and size can only change while nobody has signed up and no matches exist.",
    );
  }
  if (!MODES_FOR_GAME[t.game].includes(mode))
    throw new AppError("VALIDATION", "This mode is not available for this game.", {
      mode: ["Not available for this game"],
    });
  if (format === "BRACKET" && (!size || !isBracketSize(size)))
    throw new AppError("VALIDATION", "Choose 8 or 16 entries.", {
      bracketSize: ["Choose 8 or 16 entries"],
    });
  return { entry, mode, startsAt, format, slots: size! };
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
                bracketSize: change.format === "BRACKET" ? change.slots : null,
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

/** Lobby-points tournaments: add N lobby matches spaced `gapMinutes` apart. */
export async function addLobbyMatches(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const v = parseInput(lobbySchema, input);
  return db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, v.tournamentId);
    if (t.format !== "LOBBY_POINTS")
      throw new AppError("VALIDATION", "Lobby matches are for solo, duo and squad tournaments.");
    const entry = await tx.match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    const existing = await tx.match.count({ where: { tournamentId: t.id, isEntryList: false } });
    const created = [];
    for (let i = 0; i < v.count; i++) {
      const startsAt = addMinutes(v.firstStartsAt, i * v.gapMinutes);
      created.push(
        await tx.match.create({
          data: {
            game: t.game,
            kind: "TOURNAMENT",
            mode: t.mode,
            title: `${t.title} — Match ${existing + i + 1}`,
            startsAt,
            registrationClosesAt: addMinutes(startsAt, -CLOSE_OFFSET_MIN),
            maxSlots: entry.maxSlots,
            status: "UPCOMING",
            tournamentId: t.id,
            streamUrl: t.streamUrl,
            createdById: me.id,
          },
        }),
      );
    }
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

/** Close the sign-up list (squads that never fully confirmed are dropped). */
async function closeEntryList(tx: Tx, entryId: string, actorId: string) {
  const entry = await tx.match.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.status === "UPCOMING")
    await applyTransition(tx, entryId, "UPCOMING", "REGISTRATION_OPEN", { actorId });
  if (entry.status === "UPCOMING" || entry.status === "REGISTRATION_OPEN") {
    await applyTransition(tx, entryId, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", { actorId });
  }
  return tx.registration.findMany({
    where: { matchId: entryId, status: "CONFIRMED" },
    orderBy: { position: "asc" },
    include: { members: { where: { status: "CONFIRMED" } } },
  });
}

type EntryRegistration = Awaited<ReturnType<typeof closeEntryList>>[number];

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

/** Lobby-points tournaments: close sign-ups and enter every confirmed entry into every lobby match. Idempotent. */
export async function lockEntries(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId } = parseInput(z.object({ tournamentId: z.string().min(1) }), input);
  return db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, tournamentId);
    if (t.format !== "LOBBY_POINTS")
      throw new AppError("VALIDATION", "Use “Generate bracket” for bracket tournaments.");
    const entries = await closeEntryList(tx, t.entryMatchId!, me.id);
    if (!entries.length) throw new AppError("CONFLICT", "No confirmed entries to enter.");
    const matches = await tx.match.findMany({
      where: {
        tournamentId,
        isEntryList: false,
        status: { in: ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"] },
      },
      orderBy: { startsAt: "asc" },
    });
    if (!matches.length) throw new AppError("CONFLICT", "Add the lobby matches first.");
    let added = 0;
    for (const m of matches) {
      const already = new Set(
        (
          await tx.registration.findMany({ where: { matchId: m.id }, select: { userId: true } })
        ).map((r) => r.userId),
      );
      for (const [i, e] of entries.entries()) {
        if (already.has(e.userId)) continue;
        await copyEntry(tx, e, m.id, i + 1);
        added++;
      }
      if (m.status === "UPCOMING")
        await applyTransition(tx, m.id, "UPCOMING", "REGISTRATION_OPEN", { actorId: me.id });
      if (m.status !== "REGISTRATION_CLOSED")
        await applyTransition(tx, m.id, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", {
          actorId: me.id,
        });
    }
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.lockEntries",
      entityType: "Tournament",
      entityId: t.id,
      after: { teams: entries.length, matches: matches.length, added },
    });
    return { teams: entries.length, matches: matches.length };
  });
}

async function createBracketMatch(
  tx: Tx,
  t: { id: string; game: Game; mode: MatchMode; title: string; streamUrl: string | null },
  round: number,
  index: number,
  totalRounds: number,
  startsAt: Date,
  actorId: string | null,
  createdById: string,
) {
  return tx.match.create({
    data: {
      game: t.game,
      kind: "TOURNAMENT",
      mode: t.mode,
      title: `${t.title} — ${roundName(round, totalRounds)}${totalRounds - round >= 1 ? ` ${index + 1}` : ""}`,
      startsAt,
      registrationClosesAt: addMinutes(startsAt, -CLOSE_OFFSET_MIN),
      maxSlots: 2,
      status: "REGISTRATION_CLOSED",
      tournamentId: t.id,
      bracketRound: round,
      bracketIndex: index,
      streamUrl: t.streamUrl,
      createdById: actorId ?? createdById,
    },
  });
}

const bracketSchema = z.object({
  tournamentId: z.string().min(1),
  firstRoundStartsAt: istDateTime,
});

/** Head-to-head modes: close sign-ups and seed exactly 8 or 16 confirmed entries into round 1. */
export async function generateBracket(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId, firstRoundStartsAt } = parseInput(bracketSchema, input);
  return db.$transaction(async (tx) => {
    const t = await loadOpenTournament(tx, tournamentId);
    if (t.format !== "BRACKET" || !t.bracketSize || !isBracketSize(t.bracketSize)) {
      throw new AppError("VALIDATION", "This tournament does not use a bracket.");
    }
    if (await tx.match.count({ where: { tournamentId, bracketRound: { not: null } } })) {
      throw new AppError("CONFLICT", "The bracket has already been generated.");
    }
    const entries = await closeEntryList(tx, t.entryMatchId!, me.id);
    if (entries.length !== t.bracketSize) {
      throw new AppError(
        "VALIDATION",
        `The bracket needs exactly ${t.bracketSize} confirmed entries (have ${entries.length}).`,
      );
    }
    const totalRounds = roundCount(t.bracketSize as BracketSize);
    const pairs = firstRoundPairs(entries);
    const created = [];
    for (const [index, [a, b]] of pairs.entries()) {
      const m = await createBracketMatch(
        tx,
        t,
        1,
        index,
        totalRounds,
        firstRoundStartsAt,
        me.id,
        me.id,
      );
      await copyEntry(tx, a, m.id, 1);
      await copyEntry(tx, b, m.id, 2);
      created.push(m);
    }
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.bracket",
      entityType: "Tournament",
      entityId: t.id,
      after: { round1: created.map((m) => m.id) },
    });
    return created;
  });
}

/** The approved winning registration of a bracket match, or null. */
async function bracketWinner(tx: Tx, matchId: string) {
  const res = await tx.result.findFirst({
    where: { matchId, won: true, approvedAt: { not: null } },
    select: { registrationId: true },
  });
  if (!res) return null;
  return tx.registration.findUniqueOrThrow({
    where: { id: res.registrationId },
    include: { members: { where: { status: "CONFIRMED" } } },
  });
}

/**
 * Called inside the results-approval transaction: once both feeder matches of a next-round slot
 * are decided, create (or refresh, if not started) the next-round match with the two winners.
 */
export async function advanceBracket(tx: Tx, matchId: string, actorId: string | null) {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      tournamentId: true,
      bracketRound: true,
      bracketIndex: true,
      startsAt: true,
      createdById: true,
    },
  });
  if (!match.tournamentId || match.bracketRound === null || match.bracketIndex === null)
    return null;
  const t = await loadTournament(tx, match.tournamentId);
  if (t.format !== "BRACKET" || !t.bracketSize) return null;
  const totalRounds = roundCount(t.bracketSize as BracketSize);
  if (match.bracketRound >= totalRounds) return null; // final decided

  const sibling = await tx.match.findFirst({
    where: {
      tournamentId: t.id,
      bracketRound: match.bracketRound,
      bracketIndex: siblingIndex(match.bracketIndex),
    },
  });
  if (!sibling) return null;
  const [mine, theirs] = await Promise.all([
    bracketWinner(tx, matchId),
    bracketWinner(tx, sibling.id),
  ]);
  if (!mine || !theirs) return null;

  const slot = nextSlot(match.bracketRound, match.bracketIndex);
  const [first, second] = slot.side === 0 ? [mine, theirs] : [theirs, mine];
  let next = await tx.match.findFirst({
    where: { tournamentId: t.id, bracketRound: slot.round, bracketIndex: slot.index },
  });
  if (next && !["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(next.status))
    return next; // already played
  if (next) {
    await tx.registrationMember.deleteMany({ where: { matchId: next.id } });
    await tx.registration.deleteMany({ where: { matchId: next.id } });
  } else {
    const later = match.startsAt > sibling.startsAt ? match.startsAt : sibling.startsAt;
    next = await createBracketMatch(
      tx,
      t,
      slot.round,
      slot.index,
      totalRounds,
      addMinutes(later, NEXT_ROUND_GAP_MIN),
      actorId,
      match.createdById,
    );
  }
  await copyEntry(tx, first, next.id, 1);
  await copyEntry(tx, second, next.id, 2);
  await writeAudit(tx, {
    actorId,
    action: "tournament.advance",
    entityType: "Match",
    entityId: next.id,
    after: {
      round: slot.round,
      index: slot.index,
      teams: [first.teamId ?? first.userId, second.teamId ?? second.userId],
    },
  });
  return next;
}

const NOT_STARTED = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"] as const;

/**
 * Called inside the results-reopen transaction for a bracket match: undo advanceBracket.
 * The advanced side leaves the next-round match (deleted when it has nobody left) so that
 * approving again re-advances the right winner. Refuses once the next-round match has started.
 */
export async function rollbackBracketAdvance(tx: Tx, matchId: string) {
  const match = await tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { tournamentId: true, bracketRound: true, bracketIndex: true },
  });
  if (!match.tournamentId || match.bracketRound === null || match.bracketIndex === null)
    return null;
  const slot = nextSlot(match.bracketRound, match.bracketIndex);
  const next = await tx.match.findFirst({
    where: { tournamentId: match.tournamentId, bracketRound: slot.round, bracketIndex: slot.index },
    select: { id: true, status: true },
  });
  if (!next) return null;
  if (!(NOT_STARTED as readonly string[]).includes(next.status)) {
    throw new AppError(
      "CONFLICT",
      "The next-round match has already started. Reopen or cancel that match first.",
    );
  }
  const winner = await bracketWinner(tx, matchId);
  if (winner) {
    const side = winner.teamId
      ? { teamId: winner.teamId }
      : { userId: winner.userId, teamId: null };
    await tx.registrationMember.deleteMany({
      where: { matchId: next.id, registration: side },
    });
    await tx.registration.deleteMany({ where: { matchId: next.id, ...side } });
  }
  const left = await tx.registration.count({ where: { matchId: next.id } });
  if (!left) {
    await tx.registrationMember.deleteMany({ where: { matchId: next.id } });
    await tx.match.delete({ where: { id: next.id } });
  }
  return { nextMatchId: next.id, removed: winner?.id ?? null, deleted: !left };
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
  t: { id: string; format: "BRACKET" | "LOBBY_POINTS"; bracketSize: number | null },
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
  return bracketPodium(results, roundCount(t.bracketSize as BracketSize));
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
