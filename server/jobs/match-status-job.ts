import "server-only";
import { db, type Tx } from "@/server/db";
import { isAppError } from "@/server/errors";
import {
  releaseUnplaced,
  sendLobbyNotices,
  splitIntoLobbies,
  type LobbySplit,
} from "@/server/services/lobbies";
import { applyTransition } from "@/server/services/match-status";
import {
  cancelMatchInTx,
  finishCancellation,
  notifyResultsOpen,
  type MatchCancellation,
} from "@/server/services/matches";
import type { Game } from "@/lib/games";
import { dueTransition, type MatchStatus } from "@/lib/match-state";
import { addMinutes } from "@/lib/time";

export interface TransitionRecord {
  matchId: string;
  from: MatchStatus;
  to: MatchStatus;
}

/** Shortest match length (Free Fire, 20 min): anything LIVE for less cannot be due yet. */
const MIN_MATCH_MINUTES = 20;

export const NOT_ENOUGH_PLAYERS = "Not enough players";

interface Candidate {
  id: string;
  game: Game;
  status: MatchStatus;
  startsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date;
  minSlots: number;
  isEntryList: boolean;
  bracketRound: number | null;
}

/**
 * Minimum-slot rule applies to playable, non-bracket matches (sign-up lists are never played;
 * bracket sides are filled by the bracket, not by registration).
 */
function hasMinimum(m: Candidate): boolean {
  return !m.isEntryList && m.bracketRound === null && m.minSlots > 0;
}

/** Inside the close transaction: cancel (and refund) when fewer than minSlots entries are confirmed. */
async function cancelIfShort(
  tx: Tx,
  m: Candidate,
  status: MatchStatus,
): Promise<MatchCancellation | null> {
  const confirmed = await tx.registration.count({
    where: { matchId: m.id, status: "CONFIRMED" },
  });
  if (confirmed >= m.minSlots) return null;
  return cancelMatchInTx(tx, { id: m.id, status }, NOT_ENOUGH_PLAYERS, {
    actorId: null,
    action: "match.cancel.auto",
  });
}

/**
 * Apply every time-driven transition that is due at `now`.
 * When registration closes with fewer confirmed entries than `minSlots`, the match is cancelled
 * (refunds + notifications). LIVE -> RESULTS_PENDING asks registrants to submit their result.
 * Idempotent: transitions are conditional on the current status, so overlapping runs
 * (or a rerun) never apply the same step twice.
 */
export async function runMatchStatusJob(now = new Date()): Promise<TransitionRecord[]> {
  const candidates: Candidate[] = await db.match.findMany({
    where: {
      OR: [
        { status: "UPCOMING", registrationOpensAt: { lte: now } },
        // Never opened (manual opening forgotten) and past its close time: nobody could register.
        {
          status: "UPCOMING",
          registrationOpensAt: null,
          registrationClosesAt: { lte: now },
          isEntryList: false,
          bracketRound: null,
          minSlots: { gt: 0 },
        },
        { status: "REGISTRATION_OPEN", registrationClosesAt: { lte: now } },
        // Tournament sign-up lists are never played: they stop at REGISTRATION_CLOSED.
        { status: "REGISTRATION_CLOSED", startsAt: { lte: now }, isEntryList: false },
        {
          status: "LIVE",
          startsAt: { lte: addMinutes(now, -MIN_MATCH_MINUTES) },
          isEntryList: false,
        },
      ],
    },
    select: {
      id: true,
      game: true,
      status: true,
      startsAt: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      minSlots: true,
      isEntryList: true,
      bracketRound: true,
    },
    take: 500,
  });

  const applied: TransitionRecord[] = [];
  for (const candidate of candidates) {
    let match = candidate;
    for (let step = 0; step < 4; step++) {
      const to = dueTransition(match, now);
      const neverOpened =
        !to &&
        match.status === "UPCOMING" &&
        match.registrationClosesAt <= now &&
        hasMinimum(match);
      if (!to && !neverOpened) break;
      let cancellation: MatchCancellation | null = null;
      let split: LobbySplit | null = null;
      try {
        ({ cancellation, split } = await db.$transaction(async (tx) => {
          if (!to) return { cancellation: await cancelIfShort(tx, match, match.status), split: null };
          await applyTransition(tx, match.id, match.status, to, { actorId: null });
          if (to !== "REGISTRATION_CLOSED") return { cancellation: null, split: null };
          const short = hasMinimum(match) ? await cancelIfShort(tx, match, to) : null;
          if (short) return { cancellation: short, split: null };
          // Open entry: more entries than one lobby holds become more lobbies.
          return { cancellation: null, split: await splitIntoLobbies(tx, match.id, null) };
        }));
      } catch (e) {
        // Another run (or an admin) moved it first: stop here, the next run re-evaluates.
        if (isAppError(e) && e.code === "CONFLICT") break;
        throw e;
      }
      if (to) applied.push({ matchId: match.id, from: match.status, to });
      if (cancellation) {
        applied.push({ matchId: match.id, from: to ?? match.status, to: "CANCELLED" });
        await finishCancellation(cancellation);
        break;
      }
      if (!to) break;
      await sendLobbyNotices(split);
      if (to === "LIVE") await releaseUnplaced(match.id);
      if (match.status === "LIVE" && to === "RESULTS_PENDING") await notifyResultsOpen(match.id);
      match = { ...match, status: to };
    }
  }
  return applied;
}
