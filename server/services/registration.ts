import "server-only";
import { z } from "zod";
import type { RegistrationStatus } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { paymentProvider, paymentsEnabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { catchUpMatchStatuses } from "@/server/jobs/status-catch-up";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { isBanRecordActive, isRegistrationBlocked } from "@/lib/bans";
import { GAME_CONFIG } from "@/lib/games";
import { takesEveryone } from "@/lib/lobbies";
import { isTeamMode, playersPerSlot } from "@/lib/match-schema";
import {
  isGameProfileComplete,
  missingForRegistration,
  PHONE_FOR_MONEY_MESSAGE,
  PHONE_ITEM,
} from "@/lib/profile";
import {
  BLOCK_MESSAGE,
  canCancelRegistration,
  placementFor,
  registrationBlock,
} from "@/lib/registration-rules";
import { assertUser, type Actor } from "@/lib/roles";
import { gameProfileRecord, gameProfileSchema } from "@/lib/validators";
import { notify, type NotificationEvent } from "./notify";
import { trackOnce } from "./analytics";
import { teamNameSchema } from "./teams";
import { enterPendingPayment } from "./payments";

/** Registration statuses that occupy a slot. PENDING_PAYMENT holds the slot while paying (Phase 6). */
export const SLOT_HOLDING: RegistrationStatus[] = ["CONFIRMED", "PENDING_PAYMENT"];
/** Registration statuses that still count as "registered" for duplicate checks. */
const ACTIVE: RegistrationStatus[] = ["PENDING", "PENDING_PAYMENT", "CONFIRMED", "WAITLISTED"];

/** Serialise every registration change for a match (row lock held until the transaction ends). */
export async function lockMatch(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      game: true,
      mode: true,
      status: true,
      startsAt: true,
      registrationClosesAt: true,
      maxSlots: true,
      entryFeePaise: true,
      isEntryList: true,
      tournamentId: true,
      bracketRound: true,
      parentMatchId: true,
    },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  return match;
}

type LockedMatch = Awaited<ReturnType<typeof lockMatch>>;

/** Open-entry scrims and tournament sign-ups take everyone (split at close); others fill up to maxSlots. */
function capacityOf(match: LockedMatch): number {
  return takesEveryone(match) ? Number.POSITIVE_INFINITY : match.maxSlots;
}

async function slotsTaken(tx: Tx, matchId: string) {
  return tx.registration.count({ where: { matchId, status: { in: SLOT_HOLDING } } });
}

async function nextPosition(tx: Tx, matchId: string) {
  const agg = await tx.registration.aggregate({ where: { matchId }, _max: { position: true } });
  return (agg._max.position ?? 0) + 1;
}

/** Everyone who plays under a registration: the registrant plus confirmed roster members. */
async function playersOf(tx: Tx, registrationId: string, registrantId: string) {
  const roster = await tx.registrationMember.findMany({
    where: { registrationId },
    select: { userId: true },
  });
  return [...new Set([registrantId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))])];
}

/** Is this user already playing in this match (own registration or someone's roster)? */
async function alreadyInMatch(tx: Tx, matchId: string, userIds: string[]) {
  const [regs, roster] = await Promise.all([
    tx.registration.findMany({
      where: { matchId, userId: { in: userIds }, status: { in: ACTIVE } },
      select: { userId: true },
    }),
    tx.registrationMember.findMany({
      where: { matchId, userId: { in: userIds }, registration: { status: { in: ACTIVE } } },
      select: { userId: true },
    }),
  ]);
  return new Set([...regs.map((r) => r.userId), ...roster.map((r) => r.userId)]);
}

/**
 * Fill free slots from the waitlist, lowest position first. Returns the promoted registrations' players.
 */
export async function promoteWaitlist(
  tx: Tx,
  match: Pick<LockedMatch, "id" | "maxSlots" | "entryFeePaise">,
): Promise<string[]> {
  const promoted: string[] = [];
  let taken = await slotsTaken(tx, match.id);
  while (taken < match.maxSlots) {
    const next = await tx.registration.findFirst({
      where: { matchId: match.id, status: "WAITLISTED" },
      orderBy: { position: "asc" },
    });
    if (!next) break;
    // Paid matches: the promoted player gets a 10-minute window to pay; free matches confirm at once.
    if (match.entryFeePaise > 0) await enterPendingPayment(tx, next, match);
    else await tx.registration.update({ where: { id: next.id }, data: { status: "CONFIRMED" } });
    promoted.push(...(await playersOf(tx, next.id, next.userId)));
    taken++;
  }
  return promoted;
}

export const REGISTER_LIMIT = { limit: 20, windowSeconds: 600 };

const registerSchema = z.object({
  matchId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  memberIds: z.array(z.string().min(1)).max(10).optional(),
  /** Captain-entered roster: team name + every teammate's game ID and exact in-game name. */
  teamName: z.string().max(40).optional(),
  players: z
    .array(z.object({ gameId: z.string().max(40), ign: z.string().max(40).optional() }))
    .max(10)
    .optional(),
});

export interface RosterPlayer {
  gameId: string;
  ign: string;
  /** The account that owns this game ID, if any (it gets points and sees the room). */
  userId: string | null;
}

/**
 * Validate a captain-entered roster: exactly the mode's team size (captain first, from his own
 * profile), valid IDs with exact in-game names, no duplicates, no banned IDs or blocked accounts,
 * nobody already playing in this match.
 */
async function buildRoster(
  tx: Tx,
  match: LockedMatch,
  captainId: string,
  captain: { gameId: string; ign: string | null },
  players: { gameId: string; ign?: string }[],
  now: Date,
): Promise<RosterPlayer[]> {
  const size = playersPerSlot(match.game, match.mode);
  if (players.length !== size - 1) {
    throw new AppError("VALIDATION", `Enter all ${size - 1} teammates.`, {
      players: [`Enter all ${size - 1} teammates`],
    });
  }
  const fieldErrors: Record<string, string[]> = {};
  const roster: RosterPlayer[] = [
    { gameId: captain.gameId, ign: captain.ign ?? captain.gameId, userId: captainId },
  ];
  for (const [i, p] of players.entries()) {
    const parsed = gameProfileSchema.safeParse({
      game: match.game,
      gameId: p.gameId,
      ign: p.ign,
      region: "AP",
    });
    if (!parsed.success) {
      fieldErrors[`players.${i}`] = [
        parsed.error.issues[0]?.message ?? "Check this player's ID and name",
      ];
      continue;
    }
    const record = gameProfileRecord(parsed.data);
    roster.push({ gameId: record.gameId, ign: record.ign ?? record.gameId, userId: null });
  }
  if (Object.keys(fieldErrors).length) {
    throw new AppError("VALIDATION", "Check the highlighted players.", fieldErrors);
  }
  const label = GAME_CONFIG[match.game].idLabel;
  const ids = roster.map((p) => p.gameId);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new AppError("VALIDATION", `The same ${label} is entered twice (${dupe}).`);

  const bans = await tx.ban.findMany({
    where: { game: match.game, gameId: { in: ids } },
    select: { gameId: true, expiresAt: true, liftedAt: true },
  });
  const banned = bans.find((b) => isBanRecordActive(b, now));
  if (banned) {
    const who = roster.find((p) => p.gameId === banned.gameId)!;
    throw new AppError("FORBIDDEN", `${who.ign} (${label} ${who.gameId}) is banned.`);
  }

  // Link teammates who have an account with that ID: they get points and see the room.
  const profiles = await tx.gameProfile.findMany({
    where: { game: match.game, gameId: { in: ids } },
    select: {
      gameId: true,
      userId: true,
      user: {
        select: {
          bannedAt: true,
          bannedUntil: true,
          registrationBlockedUntil: true,
          deletedAt: true,
        },
      },
    },
  });
  for (const p of roster) {
    const owner = profiles.find((g) => g.gameId === p.gameId);
    if (!owner || p.userId) continue;
    if (owner.user.deletedAt) continue;
    if (isRegistrationBlocked(owner.user, now)) {
      throw new AppError("FORBIDDEN", `${p.ign} is blocked from registering right now.`);
    }
    p.userId = owner.userId;
  }

  const linked = roster.flatMap((p) => (p.userId ? [p.userId] : []));
  const [clashIds, clashIgns] = await Promise.all([
    alreadyInMatch(tx, match.id, linked),
    tx.registrationMember.findMany({
      where: { matchId: match.id, gameId: { in: ids }, registration: { status: { in: ACTIVE } } },
      select: { gameId: true },
    }),
  ]);
  const taken = roster.filter(
    (p) => (p.userId && clashIds.has(p.userId)) || clashIgns.some((c) => c.gameId === p.gameId),
  );
  if (taken.length) {
    throw new AppError(
      "CONFLICT",
      `Already playing in this match: ${taken.map((p) => p.ign).join(", ")}.`,
    );
  }
  return roster;
}

export interface RegisterResult {
  registrationId: string;
  status: RegistrationStatus;
}

/**
 * Register for a match. Solo/duo: the player takes a slot or joins the waitlist (open-entry scrims
 * never fill: extra lobbies are opened when registration closes).
 * Squad/5v5: the captain registers a team with a chosen roster; the registration stays PENDING
 * until every member confirms (see respondToRoster).
 */
export async function registerForMatch(
  actor: Actor | null,
  input: unknown,
  now = new Date(),
): Promise<RegisterResult> {
  const me = assertUser(actor);
  const { matchId, teamId, memberIds, teamName, players } = parseInput(registerSchema, input);
  await enforceRateLimit(
    `register:${me.id}`,
    REGISTER_LIMIT.limit,
    REGISTER_LIMIT.windowSeconds,
    "Too many registration attempts. Please wait a few minutes.",
  );
  // Registration that just opened (or closed) by the clock counts now, not at the next cron run.
  await catchUpMatchStatuses();
  const events: NotificationEvent[] = [];

  const result = await db.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: me.id },
      include: { gameProfiles: { select: { game: true, gameId: true, ign: true } } },
    });

    const missing = missingForRegistration(user, match.game);
    if (missing.length) {
      throw new AppError(
        "PROFILE_INCOMPLETE",
        `Complete your profile first: add your ${missing.join(", ")}.`,
        { missing },
      );
    }
    // Cashfree needs the payer's mobile number (DECISIONS M31); Razorpay doesn't (M43).
    if (match.entryFeePaise > 0 && !user.phone && paymentProvider() === "cashfree") {
      throw new AppError("PROFILE_INCOMPLETE", PHONE_FOR_MONEY_MESSAGE, { missing: [PHONE_ITEM] });
    }
    const block = registrationBlock(user, match, now, paymentsEnabled());
    if (block)
      throw new AppError(block === "BLOCKED" ? "FORBIDDEN" : "CONFLICT", BLOCK_MESSAGE[block]);
    if ((await alreadyInMatch(tx, matchId, [me.id])).size) {
      throw new AppError("CONFLICT", "You are already registered for this match.");
    }

    const existing = await tx.registration.findUnique({
      where: { matchId_userId: { matchId, userId: me.id } },
    });
    const position = await nextPosition(tx, matchId);

    if (!isTeamMode(match.mode)) {
      const placed = placementFor(await slotsTaken(tx, matchId), capacityOf(match));
      const paid = match.entryFeePaise > 0;
      const status: RegistrationStatus =
        placed === "CONFIRMED" && paid ? "PENDING_PAYMENT" : placed;
      const data = { status, position, teamId: null, cancelledAt: null };
      const reg = existing
        ? await tx.registration.update({ where: { id: existing.id }, data })
        : await tx.registration.create({ data: { ...data, matchId, userId: me.id } });
      if (status === "PENDING_PAYMENT") await enterPendingPayment(tx, reg, match, now);
      if (status === "CONFIRMED")
        events.push({ type: "REGISTRATION_CONFIRMED", userIds: [me.id], matchId });
      return { registrationId: reg.id, status };
    }

    // The captain enters the whole roster by game ID (DECISIONS M13): confirmed at once, no invites.
    if (players) {
      const captainProfile = user.gameProfiles.find((p) => p.game === match.game)!;
      const roster = await buildRoster(tx, match, me.id, captainProfile, players, now);
      const placed = placementFor(await slotsTaken(tx, matchId), capacityOf(match));
      const status: RegistrationStatus =
        placed === "CONFIRMED" && match.entryFeePaise > 0 ? "PENDING_PAYMENT" : placed;
      // Filled from the player's saved team (DECISIONS M17): link it so results count for the team.
      const saved = teamId ? await savedTeamFor(tx, teamId, me.id, match.game) : null;
      const name = saved
        ? saved.name
        : parseInput(z.object({ teamName: teamNameSchema }), { teamName }).teamName;
      const data = {
        status,
        position,
        teamId: saved?.id ?? null,
        teamName: name,
        cancelledAt: null,
      };
      const reg = existing
        ? await tx.registration.update({ where: { id: existing.id }, data })
        : await tx.registration.create({ data: { ...data, matchId, userId: me.id } });
      await tx.registrationMember.createMany({
        data: roster.map((p) => ({
          registrationId: reg.id,
          matchId,
          userId: p.userId,
          gameId: p.gameId,
          ign: p.ign,
          status: "CONFIRMED" as const,
          respondedAt: now,
        })),
      });
      if (status === "PENDING_PAYMENT") await enterPendingPayment(tx, reg, match, now);
      if (status === "CONFIRMED") {
        const linked = roster.flatMap((p) => (p.userId ? [p.userId] : []));
        events.push({
          type: "REGISTRATION_CONFIRMED",
          userIds: [...new Set([me.id, ...linked])],
          matchId,
        });
      }
      return { registrationId: reg.id, status };
    }

    const roster = await validateRoster(tx, match, me.id, teamId, memberIds ?? [], now);
    const data = { status: "PENDING" as const, position, teamId: teamId!, cancelledAt: null };
    const reg = existing
      ? await tx.registration.update({ where: { id: existing.id }, data })
      : await tx.registration.create({ data: { ...data, matchId, userId: me.id } });
    await tx.registrationMember.createMany({
      data: roster.map((userId) => ({
        registrationId: reg.id,
        matchId,
        userId,
        status: userId === me.id ? ("CONFIRMED" as const) : ("INVITED" as const),
        respondedAt: userId === me.id ? now : null,
      })),
    });
    events.push({ type: "ROSTER_INVITE", userIds: roster.filter((u) => u !== me.id), matchId });
    return { registrationId: reg.id, status: "PENDING" as const };
  });

  await Promise.all(events.map(notify));
  await trackOnce("FIRST_REGISTRATION", me.id);
  return result;
}

/** The saved team a roster was filled from: same game, and the registering player is in it. */
async function savedTeamFor(tx: Tx, teamId: string, userId: string, game: LockedMatch["game"]) {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      game: true,
      members: { where: { userId, status: "CONFIRMED" } },
    },
  });
  if (!team || team.game !== game || !team.members.length) {
    throw new AppError("VALIDATION", "Choose one of your own teams for this game.", {
      teamId: ["Choose one of your own teams for this game"],
    });
  }
  return team;
}

/** Validate the captain's roster choice and return the player IDs (captain included). */
async function validateRoster(
  tx: Tx,
  match: LockedMatch,
  captainId: string,
  teamId: string | undefined,
  memberIds: string[],
  now: Date,
): Promise<string[]> {
  if (!teamId)
    throw new AppError("VALIDATION", "Choose the team you are registering.", {
      teamId: ["Choose a team"],
    });
  const team = await tx.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        where: { status: "CONFIRMED" },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              bannedAt: true,
              bannedUntil: true,
              registrationBlockedUntil: true,
              gameProfiles: { select: { game: true, ign: true } },
            },
          },
        },
      },
    },
  });
  if (!team) throw new AppError("NOT_FOUND", "Team not found.");
  if (team.captainId !== captainId)
    throw new AppError("FORBIDDEN", "Only the team captain can register the team.");
  if (team.game !== match.game)
    throw new AppError("VALIDATION", "This team plays a different game.");

  const size = playersPerSlot(match.game, match.mode);
  const chosen = [...new Set([captainId, ...memberIds])];
  if (chosen.length !== size) {
    throw new AppError("VALIDATION", `Pick exactly ${size} players including yourself.`, {
      memberIds: [`Pick exactly ${size} players`],
    });
  }
  const members = new Map(team.members.map((m) => [m.userId, m.user]));
  for (const id of chosen) {
    const u = members.get(id);
    if (!u)
      throw new AppError("VALIDATION", "Every player must be a confirmed member of the team.");
    const gp = u.gameProfiles.find((p) => p.game === match.game);
    if (!gp || !isGameProfileComplete(gp)) {
      throw new AppError(
        "VALIDATION",
        `${u.displayName ?? "A teammate"} has not added ${gp ? "their exact in-game name" : "a game ID"} for this game.`,
      );
    }
    if (isRegistrationBlocked(u, now))
      throw new AppError(
        "FORBIDDEN",
        `${u.displayName ?? "A teammate"} is blocked from registering.`,
      );
  }
  const clash = await alreadyInMatch(tx, match.id, chosen);
  if (clash.size) {
    const names = chosen
      .filter((id) => clash.has(id))
      .map((id) => members.get(id)?.displayName ?? "A teammate");
    throw new AppError("CONFLICT", `Already registered for this match: ${names.join(", ")}.`);
  }
  return chosen;
}

const respondSchema = z.object({ matchId: z.string().min(1), accept: z.boolean() });

/** A roster member confirms or declines their spot. When everyone confirms, the squad is placed. */
export async function respondToRoster(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertUser(actor);
  const { matchId, accept } = parseInput(respondSchema, input);
  const events: NotificationEvent[] = [];

  const outcome = await db.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    const row = await tx.registrationMember.findUnique({
      where: { matchId_userId: { matchId, userId: me.id } },
      include: { registration: true },
    });
    if (!row || row.status !== "INVITED" || row.registration.status !== "PENDING") {
      throw new AppError("NOT_FOUND", "You have no pending invitation for this match.");
    }
    if (match.status !== "REGISTRATION_OPEN" || now >= match.registrationClosesAt) {
      throw new AppError("CONFLICT", "Registration for this match has closed.");
    }

    if (!accept) {
      await tx.registration.update({
        where: { id: row.registrationId },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      await tx.registrationMember.deleteMany({ where: { registrationId: row.registrationId } });
      return "DECLINED" as const;
    }

    await tx.registrationMember.update({
      where: { id: row.id },
      data: { status: "CONFIRMED", respondedAt: now },
    });
    const waiting = await tx.registrationMember.count({
      where: { registrationId: row.registrationId, status: { not: "CONFIRMED" } },
    });
    if (waiting > 0) return "PENDING" as const;

    const placed = placementFor(await slotsTaken(tx, matchId), capacityOf(match));
    const status: RegistrationStatus =
      placed === "CONFIRMED" && match.entryFeePaise > 0 ? "PENDING_PAYMENT" : placed;
    await tx.registration.update({
      where: { id: row.registrationId },
      data: { status, position: await nextPosition(tx, matchId) },
    });
    // Paid squads: the captain pays within 10 minutes of the squad completing.
    if (status === "PENDING_PAYMENT") await enterPendingPayment(tx, row.registration, match, now);
    if (status === "CONFIRMED") {
      events.push({
        type: "REGISTRATION_CONFIRMED",
        userIds: await playersOf(tx, row.registrationId, row.registration.userId),
        matchId,
      });
    }
    return status;
  });

  await Promise.all(events.map(notify));
  return outcome;
}

const cancelSchema = z.object({ matchId: z.string().min(1) });

/**
 * Cancel my registration (or my team's, as captain) until registration closes; promotes the
 * waitlist. A paid entry fee is not refunded when the player cancels (DECISIONS M42).
 */
export async function cancelRegistration(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertUser(actor);
  const { matchId } = parseInput(cancelSchema, input);
  const events: NotificationEvent[] = [];

  await db.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    const reg = await tx.registration.findUnique({
      where: { matchId_userId: { matchId, userId: me.id } },
    });
    if (!reg || !ACTIVE.includes(reg.status))
      throw new AppError("NOT_FOUND", "You are not registered for this match.");
    if (!canCancelRegistration(match, now, reg.status !== "PENDING_PAYMENT")) {
      throw new AppError(
        "CONFLICT",
        match.entryFeePaise > 0
          ? "Paid entries cannot be cancelled."
          : "Registration has closed; you can no longer cancel.",
      );
    }
    await tx.registration.update({
      where: { id: reg.id },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
    // Money: an unpaid attempt simply fails; a paid entry is kept, not refunded (M42).
    if (reg.paymentId) {
      await tx.payment.updateMany({
        where: { id: reg.paymentId, status: "CREATED" },
        data: { status: "FAILED" },
      });
    }
    if (SLOT_HOLDING.includes(reg.status)) {
      const promoted = await promoteWaitlist(tx, match);
      if (promoted.length) events.push({ type: "WAITLIST_PROMOTED", userIds: promoted, matchId });
    }
  });

  await Promise.all(events.map(notify));
}

/** Called when registration closes: squads that never fully confirmed lose their registration. */
export async function cancelIncompleteRegistrations(tx: Tx, matchId: string, now = new Date()) {
  const pending = await tx.registration.findMany({
    where: { matchId, status: "PENDING" },
    select: { id: true },
  });
  if (!pending.length) return 0;
  const ids = pending.map((p) => p.id);
  await tx.registration.updateMany({
    where: { id: { in: ids } },
    data: { status: "CANCELLED", cancelledAt: now },
  });
  await tx.registrationMember.deleteMany({ where: { registrationId: { in: ids } } });
  return ids.length;
}

/** Is this user playing in the match with a confirmed slot (as registrant or confirmed roster member)? */
export async function isConfirmedPlayer(matchId: string, userId: string): Promise<boolean> {
  const own = await db.registration.findFirst({
    where: { matchId, userId, status: "CONFIRMED" },
    select: { id: true },
  });
  if (own) return true;
  const roster = await db.registrationMember.findFirst({
    where: { matchId, userId, status: "CONFIRMED", registration: { status: "CONFIRMED" } },
    select: { id: true },
  });
  return !!roster;
}
