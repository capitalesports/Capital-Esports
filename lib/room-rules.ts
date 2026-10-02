import type { Game } from "./games";

/**
 * Custom-room details per game (DECISIONS M22). Free Fire and BGMI rooms have an ID and a password;
 * a Valorant custom game is joined with a single party code, so it has no password. Zod-free: used
 * by client components and the server.
 */
export function roomNeedsPassword(game: Game): boolean {
  return game !== "VALORANT";
}

/** What the room identifier is called for this game. */
export function roomCodeLabel(game: Game): string {
  return roomNeedsPassword(game) ? "Room ID" : "Room code";
}
