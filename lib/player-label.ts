import type { Game } from "./games";

/**
 * How a player's game identity is shown to staff, without repeating it. A Valorant Riot ID is both
 * the ID and the name (`gameId` is its lower-cased form, `ign` the Riot ID as typed), so it appears
 * once. Free Fire / BGMI show the exact in-game name, then the numeric ID.
 */
export function playerIdLabel(game: Game, gameId: string | null, ign: string | null): string {
  if (game === "VALORANT") return ign ?? gameId ?? "no ID";
  if (!gameId) return ign ?? "no ID";
  return ign && ign !== gameId ? `${ign} · ${gameId}` : gameId;
}
