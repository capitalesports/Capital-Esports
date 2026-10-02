import "server-only";
import { z } from "zod";
import type { RegistrationStatus } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { confirmedPlayerIds } from "@/server/jobs/reminder-job";
import { parseInput } from "@/server/validation";
import {
  bulkCloneSchema,
  cancelSchema,
  cloneSchema,
  matchFormSchema,
  roomCredentialsSchema,
  type MatchData,
} from "@/lib/match-schema";
import {
  canSetRoomCredentials,
  isCloneable,
  isEditable,
  MANUAL_TRANSITIONS,
  MATCH_STATUSES,
  type MatchStatus,
} from "@/lib/match-state";
import { assertAdmin, assertModerator, type Actor } from "@/lib/roles";
import { roomNeedsPassword } from "@/lib/room-rules";
import { addDays } from "@/lib/time";
import { releaseUnplaced, sendLobbyNotices, splitIntoLobbies } from "./lobbies";
import { applyTransition } from "./match-status";
import { notify } from "./notify";
import { executeRefunds } from "./payments";
import { refreshLeaderboard } from "./leaderboard";
import { enqueueMatchRefunds } from "./refunds";
import { restoreNoShows } from "./results";

async function loadMatch(tx: Tx, matchId: string) {
  const match = await tx.match.findUnique({ where: { id: matchId } });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  return match;
}

function linkError(message: string): AppError {
  return new AppError("VALIDATION", `${message}.`, { tournamentId: [message] });
}

/**
 * A manual match may join a tournament of the same game and mode that is not cancelled.
 * Bracket matches are created by the bracket generator only; an existing bracket match keeps its link.
 */
async function assertTournamentLink(
  tx: Tx,
  data: MatchData,
  current?: { tournamentId: string | null },
) {
  if (!data.tournamentId) return;
  const t = await tx.tournament.findUnique({ where: { id: data.tournamentId } });
  if (!t) throw linkError("Tournament not found");
  if (t.game !== data.game) throw linkError("The tournament is for another game");
  if (t.mode !== data.mode) throw linkError("The tournament is played in another mode");
  if (current?.tournamentId === t.id) return;
  if (t.cancelledAt) throw linkError("The tournament is cancelled");
  if (t.format === "BRACKET")
    throw linkError("Bracket matches are created from the tournament page");
}

/** Audit-safe snapshot: room credentials are never written to logs. */
function snapshot<T extends { roomId?: string | null; roomPassword?: string | null }>(m: T) {
  return {
    ...m,
    roomId: m.roomId ? "[set]" : null,
    roomPassword: m.roomPassword ? "[redacted]" : null,
  };
}

export async function createMatch(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const data = parseInput(matchFormSchema, input);
  return db.$transaction(async (tx) => {
    await assertTournamentLink(tx, data);
    const match = await tx.match.create({
      data: { ...data, status: "UPCOMING", createdById: me.id },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "match.create",
      entityType: "Match",
      entityId: match.id,
      after: snapshot(match),
    });
    return match;
  });
}

export async function updateMatch(actor: Actor | null, matchId: string, input: unknown) {
  const me = assertModerator(actor);
  const data = parseInput(matchFormSchema, input);
  return db.$transaction(async (tx) => {
    const before = await loadMatch(tx, matchId);
    if (!isEditable(before.status)) {
      throw new AppError("CONFLICT", "Only matches that have not started can be edited.");
    }
    const registered = await tx.registration.count({
      where: { matchId, status: { not: "CANCELLED" } },
    });
    if (registered > 0) {
      const locked = (["game", "mode", "kind"] as const).filter((k) => data[k] !== before[k]);
      if (locked.length) {
        throw new AppError(
          "CONFLICT",
          "Players have registered: the game, mode and kind can no longer change.",
          Object.fromEntries(locked.map((k) => [k, ["Locked once players register"]])),
        );
      }
    }
    const taken = await tx.registration.count({ where: { matchId, status: "CONFIRMED" } });
    if (data.maxSlots < taken) {
      throw new AppError("VALIDATION", `${taken} slots are already filled.`, {
        maxSlots: [`At least ${taken} (already filled)`],
      });
    }
    await assertTournamentLink(tx, data, before);
    const after = await tx.match.update({ where: { id: matchId }, data });
    await writeAudit(tx, {
      actorId: me.id,
      action: "match.update",
      entityType: "Match",
      entityId: matchId,
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

async function loadCloneSource(tx: Tx, matchId: string) {
  const src = await loadMatch(tx, matchId);
  if (!isCloneable(src)) {
    throw new AppError(
      "CONFLICT",
      src.parentMatchId
        ? "This is an extra lobby of a split scrim. Clone the scrim itself instead."
        : "Tournament matches, brackets and sign-up lists cannot be cloned. Use the tournament page.",
    );
  }
  return src;
}

/** Copy a match to a new start time, keeping its schedule offsets. Room credentials are not copied. */
async function cloneTo(tx: Tx, actorId: string, sourceId: string, startsAt: Date) {
  const src = await loadCloneSource(tx, sourceId);
  const shift = startsAt.getTime() - src.startsAt.getTime();
  const at = (d: Date) => new Date(d.getTime() + shift);
  const clone = await tx.match.create({
    data: {
      game: src.game,
      kind: src.kind,
      mode: src.mode,
      title: src.title,
      description: src.description,
      startsAt,
      registrationOpensAt: src.registrationOpensAt ? at(src.registrationOpensAt) : null,
      registrationClosesAt: at(src.registrationClosesAt),
      maxSlots: src.maxSlots,
      minSlots: src.minSlots,
      entryFeePaise: src.entryFeePaise,
      prizePaise: src.prizePaise,
      streamUrl: src.streamUrl,
      status: "UPCOMING",
      createdById: actorId,
    },
  });
  await writeAudit(tx, {
    actorId,
    action: "match.clone",
    entityType: "Match",
    entityId: clone.id,
    before: { sourceId },
    after: snapshot(clone),
  });
  return clone;
}

export async function cloneMatch(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, startsAt } = parseInput(cloneSchema, input);
  if (startsAt <= new Date()) {
    throw new AppError("VALIDATION", "Pick a future start time.", {
      startsAt: ["Pick a future start time"],
    });
  }
  return db.$transaction((tx) => cloneTo(tx, me.id, matchId, startsAt));
}

/** "Same match daily for the next N days": one clone per day at the same IST time. */
export async function bulkCloneMatch(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, days } = parseInput(bulkCloneSchema, input);
  return db.$transaction(async (tx) => {
    const src = await loadCloneSource(tx, matchId);
    const clones = [];
    for (let i = 1; i <= days; i++)
      clones.push(await cloneTo(tx, me.id, matchId, addDays(src.startsAt, i)));
    return clones;
  });
}

const transitionSchema = z.object({
  matchId: z.string().min(1),
  to: z
    .enum(MATCH_STATUSES)
    .refine(
      (s) => MANUAL_TRANSITIONS.includes(s) && s !== "CANCELLED",
      "Use the cancel action to cancel",
    ),
});

export async function transitionMatchStatus(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, to } = parseInput(transitionSchema, input);
  const { from, split } = await db.$transaction(async (tx) => {
    const match = await loadMatch(tx, matchId);
    if (match.isEntryList && to !== "REGISTRATION_OPEN" && to !== "REGISTRATION_CLOSED") {
      throw new AppError(
        "CONFLICT",
        "A tournament sign-up list is never played; only open or close it.",
      );
    }
    await applyTransition(tx, matchId, match.status, to, { actorId: me.id });
    // Open entry: closing registration opens as many lobbies as the entries need.
    const split = to === "REGISTRATION_CLOSED" ? await splitIntoLobbies(tx, matchId, me.id) : null;
    return { from: match.status, split };
  });
  await sendLobbyNotices(split);
  if (to === "LIVE") await releaseUnplaced(matchId);
  if (from === "LIVE" && to === "RESULTS_PENDING") await notifyResultsOpen(matchId);
}

/** "Submit your result" to every confirmed registrant (solo players and team captains). */
export async function notifyResultsOpen(matchId: string) {
  const regs = await db.registration.findMany({
    where: { matchId, status: "CONFIRMED" },
    select: { userId: true },
  });
  await notify({ type: "RESULTS_OPEN", userIds: regs.map((r) => r.userId), matchId });
}

export async function setRoomCredentials(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, roomId, roomPassword } = parseInput(roomCredentialsSchema, input);
  await db.$transaction(async (tx) => {
    const match = await loadMatch(tx, matchId);
    if (!canSetRoomCredentials(match.status)) {
      throw new AppError("CONFLICT", "Room credentials can only be set before the match ends.");
    }
    // Free Fire / BGMI rooms need a password; a Valorant room is just a code (DECISIONS M22).
    const needsPassword = roomNeedsPassword(match.game);
    if (needsPassword && !roomPassword) {
      throw new AppError("VALIDATION", "Password is required.", {
        roomPassword: ["Password is required"],
      });
    }
    // Confirmed players see them straight away (DECISIONS M20), so they're told now.
    await tx.match.update({
      where: { id: matchId },
      data: {
        roomId,
        roomPassword: needsPassword ? roomPassword : null,
        roomNoticeSentAt: new Date(),
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "match.roomCredentials",
      entityType: "Match",
      entityId: matchId,
      before: { roomId: match.roomId ? "[set]" : null },
      after: { roomId: "[set]", roomPassword: "[redacted]" },
    });
  });
  const userIds = await confirmedPlayerIds(matchId);
  if (userIds.length) await notify({ type: "ROOM_CREDENTIALS_AVAILABLE", userIds, matchId });
}

const LIVE_REGISTRATION: RegistrationStatus[] = [
  "PENDING",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "WAITLISTED",
];

export interface MatchCancellation {
  matchId: string;
  reason: string;
  cancelledRegistrations: number;
  refunds: NonNullable<Awaited<ReturnType<typeof enqueueMatchRefunds>>>;
  /** Registrants and roster members to tell about the cancellation. */
  userIds: string[];
}

/**
 * Inside a transaction: move the match to CANCELLED (audited), cancel every registration and
 * queue refunds. Call `finishCancellation` after commit to refund and notify.
 */
export async function cancelMatchInTx(
  tx: Tx,
  match: { id: string; status: MatchStatus },
  reason: string,
  ctx: { actorId: string | null; action: string },
): Promise<MatchCancellation> {
  const affected = await tx.registration.findMany({
    where: { matchId: match.id, status: { in: LIVE_REGISTRATION } },
    select: { userId: true, members: { select: { userId: true } } },
  });
  await applyTransition(tx, match.id, match.status, "CANCELLED", {
    actorId: ctx.actorId,
    action: ctx.action,
    data: { cancelReason: reason },
  });
  const { count } = await tx.registration.updateMany({
    where: { matchId: match.id, status: { notIn: ["CANCELLED"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  const refunds = await enqueueMatchRefunds(tx, match.id);
  const userIds = [
    ...new Set(
      affected.flatMap((r) => [r.userId, ...r.members.flatMap((m) => (m.userId ? [m.userId] : []))]),
    ),
  ];
  return { matchId: match.id, reason, cancelledRegistrations: count, refunds, userIds };
}

/** After commit: send the refunds to the gateway and tell every affected player. */
export async function finishCancellation(c: MatchCancellation) {
  await executeRefunds(c.refunds);
  await notify({
    type: "MATCH_CANCELLED",
    userIds: c.userIds,
    matchId: c.matchId,
    reason: c.reason,
  });
}

/**
 * Delete a match nobody is attached to (test or mistaken matches). Anything with registrations,
 * payments, results, points or prizes must be cancelled instead so money and history stay intact.
 */
export async function deleteMatch(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { matchId } = parseInput(z.object({ matchId: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const match = await loadMatch(tx, matchId);
    if (match.isEntryList || match.bracketRound !== null) {
      throw new AppError("CONFLICT", "Tournament sign-up lists and bracket matches can't be deleted. Cancel the tournament instead.");
    }
    // Money is never deleted: entry fees need refunds (cancel instead), started prizes stay on record.
    const [payments, lobbies, lockedPayouts] = await Promise.all([
      tx.payment.count({ where: { matchId } }),
      tx.match.count({ where: { parentMatchId: matchId } }),
      tx.payout.count({
        where: { matchId, voidedAt: null, OR: [{ status: { not: "PENDING" } }, { approvedAt: { not: null } }] },
      }),
    ]);
    if (payments) {
      throw new AppError("CONFLICT", "Entry fees were paid for this match. Cancel it instead, so they are refunded.");
    }
    if (lockedPayouts) {
      throw new AppError("CONFLICT", "This match's prize payout is already approved or being paid, so it can't be deleted.");
    }
    if (lobbies) {
      throw new AppError("CONFLICT", "This match was split into games. Delete those games first.");
    }
    // A played match (DECISIONS M25): take back its points and no-show strikes, void its pending
    // prize, then delete it with its registrations and results.
    const points = await tx.pointsEntry.findMany({ where: { matchId }, select: { seasonId: true } });
    const noShowsRestored = await restoreNoShows(tx, matchId);
    const { count: payoutsVoided } = await tx.payout.updateMany({
      where: { matchId, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: "Match deleted" },
    });
    const registrations = await tx.registration.count({ where: { matchId } });
    await tx.match.delete({ where: { id: matchId } });
    for (const seasonId of new Set(points.map((p) => p.seasonId))) await refreshLeaderboard(tx, seasonId);
    await writeAudit(tx, {
      actorId: me.id,
      action: "match.delete",
      entityType: "Match",
      entityId: matchId,
      // Room credentials never go into the audit log (DECISIONS D2.7).
      before: {
        ...match,
        roomId: match.roomId ? "[set]" : null,
        roomPassword: match.roomPassword ? "[redacted]" : null,
      },
      after: { registrations, pointsEntries: points.length, noShowsRestored, payoutsVoided },
    });
  });
}

/** Cancel with a reason: registrations are cancelled and any paid entries are queued for refund. */
export async function cancelMatch(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, reason } = parseInput(cancelSchema, input);
  const result = await db.$transaction(async (tx) => {
    const match = await loadMatch(tx, matchId);
    return cancelMatchInTx(tx, match, reason, { actorId: me.id, action: "match.cancel" });
  });
  await finishCancellation(result);
  return {
    cancelledRegistrations: result.cancelledRegistrations,
    refundsQueued: result.refunds.length,
  };
}
