/**
 * Pure registration rules (docs/SPEC.md "Registration rules"). The server enforces them inside a
 * transaction; the UI uses the same functions to decide which button to show.
 */
import { isRegistrationBlocked, type BanFields } from "./bans";
import type { MatchStatus } from "./match-state";

export interface RegistrationWindow {
  status: MatchStatus;
  registrationClosesAt: Date;
  entryFeePaise: number;
}

export type RegistrationBlock = "BLOCKED" | "NOT_OPEN" | "CLOSED" | "PAYMENTS_DISABLED";

export const BLOCK_MESSAGE: Record<RegistrationBlock, string> = {
  BLOCKED: "You are blocked from registering right now (ban or strike block).",
  NOT_OPEN: "Registration is not open for this match.",
  CLOSED: "Registration closed 30 minutes before the start. Late joins are not possible.",
  PAYMENTS_DISABLED: "Paid entry is coming soon. This match cannot be joined yet.",
};

/** Why this user cannot register now, or null if they can (profile checks are separate). */
export function registrationBlock(
  user: BanFields,
  match: RegistrationWindow,
  now: Date,
  paymentsEnabled: boolean,
): RegistrationBlock | null {
  if (isRegistrationBlocked(user, now)) return "BLOCKED";
  if (match.status !== "REGISTRATION_OPEN") return "NOT_OPEN";
  if (now >= match.registrationClosesAt) return "CLOSED";
  if (match.entryFeePaise > 0 && !paymentsEnabled) return "PAYMENTS_DISABLED";
  return null;
}

/** A complete registration takes a slot if one is free, otherwise joins the waitlist. */
export function placementFor(confirmedCount: number, maxSlots: number): "CONFIRMED" | "WAITLISTED" {
  return confirmedCount < maxSlots ? "CONFIRMED" : "WAITLISTED";
}

/** Players may cancel until registration closes. */
export function canCancelRegistration(
  match: Pick<RegistrationWindow, "status" | "registrationClosesAt">,
  now: Date,
) {
  return (
    (match.status === "REGISTRATION_OPEN" || match.status === "UPCOMING") &&
    now < match.registrationClosesAt
  );
}

/** Match statuses in which confirmed players see the room (it's over after these). */
export const ROOM_VISIBLE_STATUSES: readonly MatchStatus[] = [
  "UPCOMING",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "LIVE",
];

/**
 * Room credentials are served only to confirmed players, as soon as staff share them, until the
 * match is over (DECISIONS M20: no longer held back until 15 minutes before the start).
 */
export function canSeeRoomCredentials(
  match: { status: MatchStatus },
  isConfirmedPlayer: boolean,
): boolean {
  return isConfirmedPlayer && ROOM_VISIBLE_STATUSES.includes(match.status);
}

export type CardAction = "REGISTER" | "WAITLIST" | "CLOSED" | "SOON" | "PAID_SOON";

/** What a scrim card's button says. Open-entry scrims (DECISIONS M11) never fill up. */
export function cardAction(
  match: RegistrationWindow & { confirmedCount: number; maxSlots: number; openEntry?: boolean },
  now: Date,
  paymentsEnabled: boolean,
): CardAction {
  if (match.status === "UPCOMING") return "SOON";
  if (match.status !== "REGISTRATION_OPEN" || now >= match.registrationClosesAt) return "CLOSED";
  if (match.entryFeePaise > 0 && !paymentsEnabled) return "PAID_SOON";
  return match.openEntry || match.confirmedCount < match.maxSlots ? "REGISTER" : "WAITLIST";
}

export const CARD_ACTION_LABEL: Record<CardAction, string> = {
  REGISTER: "Join Now",
  WAITLIST: "Join Waitlist",
  CLOSED: "Closed",
  SOON: "Opens Soon",
  PAID_SOON: "Coming Soon",
};

/** Max members (confirmed + invited) per team: squad size plus 3 substitutes. */
export function maxTeamMembers(teamSize: number): number {
  return teamSize + 3;
}
