/**
 * Match lifecycle (docs/SPEC.md "Match state machine").
 * Illegal transitions are rejected server-side; every transition is audited by the caller.
 */
import { GAME_CONFIG, type Game } from "./games";
import { addMinutes } from "./time";

export const MATCH_STATUSES = [
  "UPCOMING",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "LIVE",
  "RESULTS_PENDING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * Allowed transitions. The spec lists REGISTRATION_OPEN -> CANCELLED; we also allow cancelling
 * before registration opens, after it closes and while the match is live (e.g. a server outage
 * mid-match; entries are refunded as for any cancellation). See DECISIONS D2.1.
 */
export const TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  UPCOMING: ["REGISTRATION_OPEN", "CANCELLED"],
  REGISTRATION_OPEN: ["REGISTRATION_CLOSED", "CANCELLED"],
  REGISTRATION_CLOSED: ["LIVE", "CANCELLED"],
  LIVE: ["RESULTS_PENDING", "CANCELLED"],
  RESULTS_PENDING: ["COMPLETED"],
  COMPLETED: ["RESULTS_PENDING"],
  CANCELLED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  UPCOMING: "Upcoming",
  REGISTRATION_OPEN: "Registration open",
  REGISTRATION_CLOSED: "Registration closed",
  LIVE: "Live",
  RESULTS_PENDING: "Results pending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Admin button label for moving into a status. */
export const TRANSITION_ACTION_LABEL: Record<MatchStatus, string> = {
  UPCOMING: "Mark upcoming",
  REGISTRATION_OPEN: "Open registration",
  REGISTRATION_CLOSED: "Close registration",
  LIVE: "Mark live",
  RESULTS_PENDING: "Move to results pending",
  COMPLETED: "Complete",
  CANCELLED: "Cancel match",
};

/** Transitions a moderator/admin may trigger with the status buttons (results use Phase 4 screens). */
export const MANUAL_TRANSITIONS: readonly MatchStatus[] = [
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "LIVE",
  "RESULTS_PENDING",
  "CANCELLED",
];

/** Statuses in which match details may still be edited. */
export function isEditable(status: MatchStatus): boolean {
  return (
    status === "UPCOMING" || status === "REGISTRATION_OPEN" || status === "REGISTRATION_CLOSED"
  );
}

export interface ScheduledMatch {
  game: Game;
  status: MatchStatus;
  startsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date;
}

/** When a LIVE match is expected to be over (startsAt + match length for the game). */
export function expectedEndAt(match: Pick<ScheduledMatch, "game" | "startsAt">): Date {
  return addMinutes(match.startsAt, GAME_CONFIG[match.game].matchMinutes);
}

/**
 * The next time-driven transition that is due at `now`, or null.
 * Used by the cron job; applying it repeatedly walks an overdue match forward one step at a time.
 */
export function dueTransition(match: ScheduledMatch, now: Date): MatchStatus | null {
  switch (match.status) {
    case "UPCOMING":
      return match.registrationOpensAt && match.registrationOpensAt <= now
        ? "REGISTRATION_OPEN"
        : null;
    case "REGISTRATION_OPEN":
      return match.registrationClosesAt <= now ? "REGISTRATION_CLOSED" : null;
    case "REGISTRATION_CLOSED":
      return match.startsAt <= now ? "LIVE" : null;
    case "LIVE":
      return expectedEndAt(match) <= now ? "RESULTS_PENDING" : null;
    default:
      return null;
  }
}

/**
 * Tournament sign-up lists, bracket matches, tournament matches and the extra lobbies of a split
 * scrim are never cloned (clone the scrim's listing instead).
 */
export function isCloneable(m: {
  isEntryList: boolean;
  bracketRound: number | null;
  tournamentId: string | null;
  parentMatchId?: string | null;
}): boolean {
  return !m.isEntryList && m.bracketRound === null && !m.tournamentId && !m.parentMatchId;
}

/** Room credentials can be set while the lobby is being prepared or running. */
export function canSetRoomCredentials(status: MatchStatus): boolean {
  return (
    status === "UPCOMING" ||
    status === "REGISTRATION_OPEN" ||
    status === "REGISTRATION_CLOSED" ||
    status === "LIVE"
  );
}
