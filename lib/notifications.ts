/**
 * Player-facing events and their in-app/push wording. Pure: the notify service supplies context
 * (match title, team name) loaded from the database.
 */
import { formatINR } from "./money";

export type NotificationEvent =
  | { type: "REGISTRATION_CONFIRMED"; userIds: string[]; matchId: string }
  | { type: "WAITLIST_PROMOTED"; userIds: string[]; matchId: string }
  | { type: "ROSTER_INVITE"; userIds: string[]; matchId: string }
  | { type: "TEAM_INVITE"; userIds: string[]; teamId: string }
  | { type: "ROOM_CREDENTIALS_AVAILABLE"; userIds: string[]; matchId: string }
  | { type: "MATCH_STARTING_SOON"; userIds: string[]; matchId: string }
  | { type: "RESULTS_APPROVED"; userIds: string[]; matchId: string }
  | { type: "DISPUTE_OPENED"; userIds: string[]; matchId: string | null }
  | { type: "DISPUTE_RESOLVED"; userIds: string[]; matchId: string | null; outcome: string }
  | { type: "PAYOUT_STATUS"; userIds: string[]; payoutId: string; status: string }
  | { type: "MATCH_CANCELLED"; userIds: string[]; matchId: string; reason: string }
  | { type: "RESULTS_OPEN"; userIds: string[]; matchId: string }
  | { type: "REGISTRATION_REMOVED"; userIds: string[]; matchId: string; reason: string }
  | { type: "ANNOUNCEMENT"; userIds: string[]; title: string; body: string; url: string | null }
  | { type: "LOBBY_ASSIGNED"; userIds: string[]; matchId: string; lobby: string }
  | { type: "LOBBY_UNPLACED"; userIds: string[]; matchId: string }
  /** A player won a prize (scrim winner, tournament podium payee). DECISIONS M28. */
  | {
      type: "PRIZE_WON";
      userIds: string[];
      amountPaise: number;
      place: number;
      /** Scrim or tournament title. */
      eventTitle: string;
    };

export type NotificationType = NotificationEvent["type"];

export const NOTIFICATION_TYPES: NotificationType[] = [
  "REGISTRATION_CONFIRMED",
  "WAITLIST_PROMOTED",
  "ROSTER_INVITE",
  "TEAM_INVITE",
  "ROOM_CREDENTIALS_AVAILABLE",
  "MATCH_STARTING_SOON",
  "RESULTS_APPROVED",
  "DISPUTE_OPENED",
  "DISPUTE_RESOLVED",
  "PAYOUT_STATUS",
  "MATCH_CANCELLED",
  "RESULTS_OPEN",
  "REGISTRATION_REMOVED",
  "ANNOUNCEMENT",
  "LOBBY_ASSIGNED",
  "LOBBY_UNPLACED",
  "PRIZE_WON",
];

/** Prizes are paid within this many working days of the win (DECISIONS M28). */
export const PRIZE_PAYOUT_WORKING_DAYS = 2;

const PLACE_WORD: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

export interface NotificationContext {
  matchTitle?: string;
  teamName?: string;
  amount?: string;
}

export interface NotificationMessage {
  type: NotificationType;
  title: string;
  body: string;
  url: string;
}

const PAYOUT_WORDS: Record<string, string> = {
  PROCESSING: "is being processed",
  SUCCESS: "has been paid",
  FAILED: "could not be completed. We will contact you",
  REVERSED: "was reversed by your bank. We will contact you",
};

/** The message shown in the inbox and in push notifications for an event. */
export function messageFor(
  event: NotificationEvent,
  ctx: NotificationContext = {},
): NotificationMessage {
  const match = ctx.matchTitle ?? "your match";
  const matchUrl = "matchId" in event && event.matchId ? `/scrims/${event.matchId}` : "/dashboard";
  switch (event.type) {
    case "REGISTRATION_CONFIRMED":
      return {
        type: event.type,
        title: "Slot confirmed",
        body: `You're in for ${match}. Room details appear on your dashboard as soon as the host shares them.`,
        url: matchUrl,
      };
    case "WAITLIST_PROMOTED":
      return {
        type: event.type,
        title: "You're off the waitlist",
        body: `A slot opened in ${match}. Check the match page to confirm it.`,
        url: matchUrl,
      };
    case "ROSTER_INVITE":
      return {
        type: event.type,
        title: "Confirm your spot",
        body: `Your captain added you to the team for ${match}. Confirm so the slot counts.`,
        url: matchUrl,
      };
    case "TEAM_INVITE":
      return {
        type: event.type,
        title: "Team invite",
        body: `You were invited to join ${ctx.teamName ?? "a team"}.`,
        url: "/teams",
      };
    case "ROOM_CREDENTIALS_AVAILABLE":
      return {
        type: event.type,
        title: "Room ID is ready",
        body: `Room ID and password for ${match} are on your dashboard. Don't share them.`,
        url: matchUrl,
      };
    case "MATCH_STARTING_SOON":
      return {
        type: event.type,
        title: "Starting in 30 minutes",
        body: `${match} starts in 30 minutes. The room ID and password are on the match page and your dashboard once the host shares them.`,
        url: matchUrl,
      };
    case "RESULTS_APPROVED":
      return {
        type: event.type,
        title: "Results are in",
        body: `Points for ${match} are posted. Disputes are open for 2 hours.`,
        url: matchUrl,
      };
    case "DISPUTE_OPENED":
      return {
        type: event.type,
        title: "New dispute",
        body: `A player disputed the results of ${match}.`,
        url: "/admin/reports",
      };
    case "DISPUTE_RESOLVED":
      return {
        type: event.type,
        title: "Dispute reviewed",
        body: `Your dispute for ${match} was ${event.outcome === "RESOLVED" ? "resolved" : "dismissed"} by a moderator.`,
        url: matchUrl,
      };
    case "PAYOUT_STATUS":
      return {
        type: event.type,
        title: event.status === "SUCCESS" ? "Prize paid" : "Prize payout update",
        body: `Your prize${ctx.amount ? ` of ${ctx.amount}` : ""} ${PAYOUT_WORDS[event.status] ?? "was updated"}.`,
        url: "/profile",
      };
    case "MATCH_CANCELLED":
      return {
        type: event.type,
        title: "Match cancelled",
        body: `${match} was cancelled: ${event.reason}. Any entry fee is refunded automatically.`,
        url: matchUrl,
      };
    case "RESULTS_OPEN":
      return {
        type: event.type,
        title: "Submit your result",
        body: `${match} is over. Submit your placement and screenshot on the match page.`,
        url: matchUrl,
      };
    case "REGISTRATION_REMOVED":
      return {
        type: event.type,
        title: "Registration removed",
        body: `A moderator removed your entry from ${match}: ${event.reason}. Any entry fee is refunded automatically.`,
        url: matchUrl,
      };
    case "ANNOUNCEMENT":
      return { type: event.type, title: event.title, body: event.body, url: event.url ?? "/" };
    case "LOBBY_ASSIGNED":
      return {
        type: event.type,
        title: `You're in ${event.lobby}`,
        body: `So many players joined that we opened more lobbies. You play in ${match}; room details appear on its page.`,
        url: matchUrl,
      };
    case "LOBBY_UNPLACED":
      return {
        type: event.type,
        title: "Waiting for an opponent",
        body: `${match} had an odd number of entries, so you have no opponent yet. An admin will place you; if not, your entry is refunded at the start.`,
        url: matchUrl,
      };
    case "PRIZE_WON":
      return {
        type: event.type,
        title: "Congratulations, you won a prize!",
        body: `You finished ${PLACE_WORD[event.place] ?? `#${event.place}`} in ${event.eventTitle} and won ${formatINR(event.amountPaise)}. You will receive your prize any time within ${PRIZE_PAYOUT_WORKING_DAYS} working days, paid to the UPI or bank account on your profile. If you haven't added one yet, add it now so the payment isn't delayed.`,
        url: "/profile",
      };
  }
}

/** Events that also go out as a push notification (when the player opted in). */
export const PUSH_EVENTS: ReadonlySet<NotificationType> = new Set([
  "REGISTRATION_CONFIRMED",
  "WAITLIST_PROMOTED",
  "ROSTER_INVITE",
  "ROOM_CREDENTIALS_AVAILABLE",
  "MATCH_STARTING_SOON",
  "RESULTS_APPROVED",
  "DISPUTE_RESOLVED",
  "PAYOUT_STATUS",
  "MATCH_CANCELLED",
  "RESULTS_OPEN",
  "REGISTRATION_REMOVED",
  "ANNOUNCEMENT",
  "LOBBY_ASSIGNED",
  "LOBBY_UNPLACED",
  "PRIZE_WON",
]);

/**
 * Events also emailed to players with a verified email who kept email notifications on. Only three
 * (DECISIONS M47), to stay within the daily email quota: the slot is confirmed (including from the
 * waitlist), the match starts in 30 minutes, the match is cancelled. Everything else is in-app only.
 */
export const EMAIL_EVENTS: ReadonlySet<NotificationType> = new Set([
  "REGISTRATION_CONFIRMED",
  "WAITLIST_PROMOTED",
  "MATCH_STARTING_SOON",
  "MATCH_CANCELLED",
]);

/** Events worth an out-of-app reminder (WhatsApp/SMS channel). */
export const REMINDER_EVENTS: ReadonlySet<NotificationType> = new Set(["MATCH_STARTING_SOON"]);
