import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/providers/storage";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { checkImage, IMAGE_EXTENSION, SCREENSHOT_MAX_BYTES } from "@/lib/image";
import { isHeadToHead, maxSlotsFor } from "@/lib/match-schema";
import {
  canReopenResults,
  duplicatePlacements,
  entriesPerPlacement,
  pointsForMatch,
  STRIKE_BLOCK_DAYS,
  STRIKES_FOR_BLOCK,
  type ScoredUnit,
} from "@/lib/points";
import { assertModerator, assertUser, type Actor } from "@/lib/roles";
import { addDays } from "@/lib/time";
import { pointsConfigFor, refreshLeaderboard } from "./leaderboard";
import { applyTransition } from "./match-status";
import { advanceBracket, rollbackBracketAdvance, unpublishWinners } from "./tournaments";
import { notify } from "./notify";

async function lockResultsMatch(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      game: true,
      kind: true,
      mode: true,
      status: true,
      maxSlots: true,
      resultsApprovedAt: true,
      tournamentId: true,
      bracketRound: true,
      bracketIndex: true,
    },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  return match;
}

/** Players who play under a registration: the registrant, or the confirmed squad roster. */
/**
 * Players who get points / strikes for a registration: the registrant plus the confirmed roster's
 * players who have an account (a captain-entered roster player without one has no points to get).
 */
async function playersFor(tx: Tx, reg: { id: string; userId: string }) {
  const roster = await tx.registrationMember.findMany({
    where: { registrationId: reg.id, status: "CONFIRMED" },
    select: { userId: true },
  });
  return [...new Set([reg.userId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))])];
}

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https:\/\//.test(v), "Tracker link must start with https://");

const submitSchema = z.object({
  matchId: z.string().min(1),
  placement: z.coerce.number().int().min(1).max(100).optional(),
  kills: z.coerce.number().int().min(0).max(99).optional(),
  won: z.boolean().optional(),
  /** Head-to-head: round difference as a magnitude; the sign comes from won/lost. */
  roundDiff: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().min(0, "0 to 13").max(13, "0 to 13").optional(),
  ),
  trackerUrl: optionalUrl,
});

export const RESULT_UPLOAD_LIMIT = { limit: 10, windowSeconds: 3600 };

/**
 * A confirmed registrant (captain for teams) submits their result while the match is RESULTS_PENDING.
 * BR: end-screen screenshot + placement + kills. Valorant: win/loss + scoreboard screenshot or tracker link.
 * Resubmitting replaces the previous submission until a moderator approves.
 */
export async function submitResult(
  actor: Actor | null,
  input: unknown,
  screenshot: Uint8Array | null,
) {
  const me = assertUser(actor);
  const data = parseInput(submitSchema, input);
  await enforceRateLimit(
    `result:${me.id}`,
    RESULT_UPLOAD_LIMIT.limit,
    RESULT_UPLOAD_LIMIT.windowSeconds,
    "Too many uploads. Try again in an hour.",
  );

  const match = await db.match.findUnique({
    where: { id: data.matchId },
    select: { id: true, game: true, mode: true, status: true },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  if (match.status !== "RESULTS_PENDING")
    throw new AppError(
      "CONFLICT",
      "Results can only be submitted while the match is waiting for results.",
    );
  const reg = await db.registration.findUnique({
    where: { matchId_userId: { matchId: match.id, userId: me.id } },
  });
  if (!reg || reg.status !== "CONFIRMED") {
    throw new AppError(
      "FORBIDDEN",
      "Only a confirmed player (or the team captain) can submit a result.",
    );
  }

  const lobby = !isHeadToHead(match.mode);
  if (lobby && (data.placement === undefined || data.kills === undefined)) {
    throw new AppError("VALIDATION", "Enter your placement and kills.", {
      placement: ["Required"],
      kills: ["Required"],
    });
  }
  if (lobby && data.placement! > maxSlotsFor(match.game, match.mode)) {
    throw new AppError("VALIDATION", "That placement is outside this lobby.", {
      placement: ["Too high for this lobby"],
    });
  }
  if (!lobby && data.won === undefined)
    throw new AppError("VALIDATION", "Say whether you won.", { won: ["Required"] });

  let screenshotUrl: string | null = null;
  if (screenshot && screenshot.length) {
    const check = checkImage(screenshot, SCREENSHOT_MAX_BYTES);
    if (!check.ok) throw new AppError("VALIDATION", check.error, { screenshot: [check.error] });
    screenshotUrl = await getStorage().put(
      `results/${match.id}/${reg.id}-${randomUUID()}.${IMAGE_EXTENSION[check.mime]}`,
      screenshot,
      check.mime,
    );
  }
  const existing = await db.result.findUnique({
    where: { matchId_registrationId: { matchId: match.id, registrationId: reg.id } },
  });
  if (!screenshotUrl && !existing?.screenshotUrl && !(!lobby && data.trackerUrl)) {
    const msg = lobby
      ? "Upload your end-screen screenshot."
      : "Upload the scoreboard screenshot or paste a tracker link.";
    throw new AppError("VALIDATION", msg, { screenshot: [msg] });
  }

  const values = {
    placement: lobby ? data.placement! : null,
    kills: lobby ? data.kills! : null,
    won: lobby ? null : data.won!,
    roundDiff:
      lobby || data.roundDiff === undefined ? null : data.won ? data.roundDiff : -data.roundDiff,
    trackerUrl: lobby ? null : data.trackerUrl,
    teamId: reg.teamId,
    userId: reg.teamId ? null : reg.userId,
    submittedById: me.id,
    submittedAt: new Date(),
    ...(screenshotUrl ? { screenshotUrl } : {}),
  };
  return db.result.upsert({
    where: { matchId_registrationId: { matchId: match.id, registrationId: reg.id } },
    create: { matchId: match.id, registrationId: reg.id, ...values },
    update: values,
  });
}

const rowSchema = z.object({
  registrationId: z.string().min(1),
  /** true = no result for this entry (treated as a no-show on approval) */
  absent: z.boolean().optional(),
  placement: z.coerce.number().int().min(1).max(100).optional(),
  kills: z.coerce.number().int().min(0).max(99).optional(),
  won: z.boolean().optional(),
  roundDiff: z.coerce.number().int().min(-13).max(13).optional(),
});
const rowsSchema = z.object({ matchId: z.string().min(1), rows: z.array(rowSchema).max(200) });

/** Moderator edits placements/kills (or winner + round difference) per entry before approving. */
export async function saveResultRows(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { matchId, rows } = parseInput(rowsSchema, input);
  await db.$transaction(async (tx) => {
    const match = await lockResultsMatch(tx, matchId);
    if (match.status !== "RESULTS_PENDING")
      throw new AppError("CONFLICT", "Results are not open for editing.");
    const lobby = !isHeadToHead(match.mode);
    const regs = await tx.registration.findMany({
      where: { matchId, status: "CONFIRMED" },
      select: { id: true, userId: true, teamId: true },
    });
    const before = await tx.result.findMany({ where: { matchId } });
    for (const row of rows) {
      const reg = regs.find((r) => r.id === row.registrationId);
      if (!reg) throw new AppError("VALIDATION", "Unknown or unconfirmed registration in results.");
      if (row.absent) {
        await tx.result.deleteMany({ where: { matchId, registrationId: reg.id } });
        continue;
      }
      if (lobby && (row.placement === undefined || row.kills === undefined)) {
        throw new AppError("VALIDATION", "Every present entry needs a placement and kills.");
      }
      const values = lobby
        ? { placement: row.placement!, kills: row.kills!, won: null, roundDiff: null }
        : { placement: null, kills: null, won: row.won ?? false, roundDiff: row.roundDiff ?? 0 };
      await tx.result.upsert({
        where: { matchId_registrationId: { matchId, registrationId: reg.id } },
        create: {
          matchId,
          registrationId: reg.id,
          teamId: reg.teamId,
          userId: reg.teamId ? null : reg.userId,
          ...values,
        },
        update: values,
      });
    }
    const after = await tx.result.findMany({ where: { matchId } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "results.edit",
      entityType: "Match",
      entityId: matchId,
      before,
      after,
    });
  });
}

/**
 * Head-to-head: approval needs exactly one winner. A side without a result is a no-show, so a
 * walkover is "the side that showed up is the winner"; with nobody there, cancel the match instead.
 */
function assertOneWinner(results: { won: boolean | null }[]) {
  if (!results.length)
    throw new AppError(
      "VALIDATION",
      "No side has a result. Mark the side that showed up as the winner (walkover), or cancel the match.",
    );
  if (results.filter((r) => r.won).length !== 1)
    throw new AppError("VALIDATION", "Mark exactly one winner.");
}

/**
 * Approve results: points for every player, NO_SHOW + strike for confirmed entries without a result,
 * a 7-day registration block at 3 strikes, match COMPLETED, cached leaderboard refreshed. One transaction.
 */
export async function approveResults(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertModerator(actor);
  const { matchId } = parseInput(z.object({ matchId: z.string().min(1) }), input);
  const summary = await db.$transaction(async (tx) => {
    const match = await lockResultsMatch(tx, matchId);
    if (match.status !== "RESULTS_PENDING")
      throw new AppError("CONFLICT", "Only matches waiting for results can be approved.");
    const season = await tx.season.findFirst({ where: { game: match.game, isActive: true } });
    if (!season)
      throw new AppError("CONFLICT", "There is no active season for this game. Start one first.");

    const regs = await tx.registration.findMany({ where: { matchId, status: "CONFIRMED" } });
    const results = await tx.result.findMany({ where: { matchId } });
    const lobby = !isHeadToHead(match.mode);
    if (lobby) {
      const missing = results.filter((r) => r.placement === null || r.kills === null);
      if (missing.length)
        throw new AppError(
          "VALIDATION",
          "Some entries have no placement or kills. Edit them first.",
        );
      const perPlacement = entriesPerPlacement(match.mode);
      const dupes = duplicatePlacements(
        results.map((r) => r.placement),
        perPlacement,
      );
      if (dupes.length)
        throw new AppError(
          "VALIDATION",
          `More than ${perPlacement === 1 ? "one entry claims" : `${perPlacement} entries claim`} the same placement (${dupes.join(", ")}). Fix the conflict first.`,
        );
    } else {
      assertOneWinner(results);
    }

    const units: ScoredUnit[] = [];
    const noShows: string[] = [];
    for (const reg of regs) {
      const result = results.find((r) => r.registrationId === reg.id);
      const players = await playersFor(tx, reg);
      if (!result) {
        noShows.push(...players);
        await tx.registration.update({ where: { id: reg.id }, data: { status: "NO_SHOW" } });
        continue;
      }
      units.push({
        registrationId: reg.id,
        playerIds: players,
        placement: result.placement,
        kills: result.kills,
        won: result.won,
        roundDiff: result.roundDiff,
      });
    }

    const config = await pointsConfigFor(tx, match.game);
    const rows = pointsForMatch(match.mode, match.kind, config, units);
    await tx.pointsEntry.createMany({
      data: rows.map((r) => ({ ...r, seasonId: season.id, matchId, createdAt: now })),
    });
    await tx.result.updateMany({
      where: { matchId },
      data: { approvedById: me.id, approvedAt: now },
    });

    for (const userId of noShows) {
      const u = await tx.user.update({
        where: { id: userId },
        data: { strikes: { increment: 1 } },
      });
      if (u.strikes >= STRIKES_FOR_BLOCK) {
        await tx.user.update({
          where: { id: userId },
          data: { registrationBlockedUntil: addDays(now, STRIKE_BLOCK_DAYS) },
        });
      }
    }

    await applyTransition(tx, matchId, "RESULTS_PENDING", "COMPLETED", {
      actorId: me.id,
      action: "results.approve",
      data: { resultsApprovedAt: now },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "results.points",
      entityType: "Match",
      entityId: matchId,
      after: { seasonId: season.id, entries: rows.length, noShowUserIds: noShows },
    });
    await refreshLeaderboard(tx, season.id);
    const prize = await (await import("./payouts")).syncMatchPrizePayout(tx, matchId, me.id);
    // Valorant brackets: the winner advances as soon as both feeder matches are decided.
    await advanceBracket(tx, matchId, me.id);
    return {
      entries: rows.length,
      noShows: noShows.length,
      playerIds: rows.map((r) => r.userId),
      newWinners: prize.newWinners,
    };
  });
  await notify({ type: "RESULTS_APPROVED", userIds: summary.playerIds, matchId });
  if (summary.newWinners.length) {
    const title =
      (await db.match.findUnique({ where: { id: matchId }, select: { title: true } }))?.title ??
      "your match";
    for (const w of summary.newWinners) {
      await notify({
        type: "PRIZE_WON",
        userIds: [w.userId],
        amountPaise: w.amountPaise,
        place: w.place,
        eventTitle: title,
      });
    }
  }
  return { entries: summary.entries, noShows: summary.noShows };
}

/**
 * Undo a match's no-shows: each NO_SHOW registration is CONFIRMED again and its players lose the
 * strike it gave them (lifting a registration block that no longer applies). Returns how many.
 * Used when results are reopened and when an admin deletes a played match.
 */
export async function restoreNoShows(tx: Tx, matchId: string): Promise<number> {
  const noShowRegs = await tx.registration.findMany({ where: { matchId, status: "NO_SHOW" } });
  for (const reg of noShowRegs) {
    await tx.registration.update({ where: { id: reg.id }, data: { status: "CONFIRMED" } });
    for (const userId of await playersFor(tx, reg)) {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { strikes: true },
      });
      const strikes = Math.max(0, u.strikes - 1);
      await tx.user.update({
        where: { id: userId },
        data: {
          strikes,
          ...(strikes < STRIKES_FOR_BLOCK ? { registrationBlockedUntil: null } : {}),
        },
      });
    }
  }
  return noShowRegs.length;
}

/**
 * Reopen approved results (dispute): moderators within 2 hours of approval, admins any time.
 * Reverses the match's PointsEntry rows and its no-show strikes, and sets RESULTS_PENDING again.
 */
export async function reopenResults(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertModerator(actor);
  const { matchId, reason } = parseInput(
    z.object({ matchId: z.string().min(1), reason: z.string().trim().max(300).optional() }),
    input,
  );
  await db.$transaction(async (tx) => {
    const match = await lockResultsMatch(tx, matchId);
    if (match.status !== "COMPLETED")
      throw new AppError("CONFLICT", "Only completed matches can be reopened.");
    if (!canReopenResults(me.role, match.resultsApprovedAt, now)) {
      throw new AppError(
        "FORBIDDEN",
        "The 2-hour dispute window has passed. Only an admin can reopen these results.",
      );
    }
    const tournament = match.tournamentId
      ? await tx.tournament.findUnique({
          where: { id: match.tournamentId },
          select: { id: true, winnersPublishedAt: true },
        })
      : null;
    if (tournament?.winnersPublishedAt && me.role !== "ADMIN") {
      throw new AppError(
        "FORBIDDEN",
        "Unpublish is not possible; winners are already published. Ask an admin.",
      );
    }
    // Throws when the next-round match has already started.
    const bracket = await rollbackBracketAdvance(tx, matchId);
    if (tournament?.winnersPublishedAt) await unpublishWinners(tx, tournament.id);
    const entries = await tx.pointsEntry.findMany({
      where: { matchId },
      select: { seasonId: true },
    });
    await tx.pointsEntry.deleteMany({ where: { matchId } });

    const noShowRegs = await restoreNoShows(tx, matchId);
    await tx.result.updateMany({
      where: { matchId },
      data: { approvedById: null, approvedAt: null },
    });
    await applyTransition(tx, matchId, "COMPLETED", "RESULTS_PENDING", {
      actorId: me.id,
      action: "results.reopen",
      data: { resultsApprovedAt: null },
    });
    // Un-started prize payouts follow the reopened results (scrim prize, unpublished podium).
    const payouts = await import("./payouts");
    await payouts.syncMatchPrizePayout(tx, matchId, me.id);
    if (tournament?.winnersPublishedAt) await payouts.syncTournamentPrizePayouts(tx, tournament.id, me.id);
    await writeAudit(tx, {
      actorId: me.id,
      action: "results.reopen.detail",
      entityType: "Match",
      entityId: matchId,
      after: {
        reason: reason || null,
        pointsEntriesReversed: entries.length,
        noShowsRestored: noShowRegs,
        bracket,
        unpublishedTournamentId: tournament?.winnersPublishedAt ? tournament.id : null,
      },
    });
    for (const seasonId of new Set(entries.map((e) => e.seasonId)))
      await refreshLeaderboard(tx, seasonId);
  });
}

/** Everything the moderator results screen needs. */
export async function getResultsForModeration(actor: Actor | null, matchId: string) {
  assertModerator(actor);
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      title: true,
      game: true,
      kind: true,
      mode: true,
      status: true,
      startsAt: true,
      maxSlots: true,
      resultsApprovedAt: true,
      bracketRound: true,
      tournament: { select: { id: true, title: true, winnersPublishedAt: true } },
    },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  const regs = await db.registration.findMany({
    where: { matchId, status: { in: ["CONFIRMED", "NO_SHOW"] } },
    orderBy: { position: "asc" },
    include: {
      user: { select: { displayName: true } },
      team: { select: { name: true } },
      results: { where: { matchId } },
    },
  });
  return {
    match,
    entries: regs.map((r) => ({
      registrationId: r.id,
      status: r.status,
      name: r.team?.name ?? r.user.displayName ?? "Player",
      result: r.results[0] ?? null,
    })),
  };
}

export async function listMatchesAwaitingResults(actor: Actor | null) {
  assertModerator(actor);
  return db.match.findMany({
    where: { status: { in: ["RESULTS_PENDING", "LIVE"] }, isEntryList: false },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      game: true,
      status: true,
      startsAt: true,
      _count: { select: { results: true, registrations: { where: { status: "CONFIRMED" } } } },
    },
  });
}
