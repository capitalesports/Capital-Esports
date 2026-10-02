/**
 * Match modes and lobby sizes: plain constants, safe to import from client components
 * (lib/match-schema.ts holds the Zod schemas and re-exports these).
 */
import type { Game } from "./games";

export const MATCH_MODES = [
  "SOLO",
  "DUO",
  "SQUAD",
  "ONE_V_ONE",
  "TWO_V_TWO",
  "FOUR_V_FOUR",
  "FIVE_V_FIVE",
] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
export const MATCH_KINDS = ["SCRIM", "TOURNAMENT"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const MODE_LABEL: Record<MatchMode, string> = {
  SOLO: "Solo",
  DUO: "Duo",
  SQUAD: "Squad",
  ONE_V_ONE: "1v1",
  TWO_V_TWO: "2v2",
  FOUR_V_FOUR: "4v4",
  FIVE_V_FIVE: "5v5",
};

/**
 * Modes allowed per game. Battle royales: solo/duo/squad lobbies plus head-to-head custom rooms
 * (Free Fire Clash Squad, BGMI TDM). Valorant is always head-to-head (DECISIONS M1).
 */
export const MODES_FOR_GAME: Record<Game, readonly MatchMode[]> = {
  FREE_FIRE: ["SOLO", "DUO", "SQUAD", "ONE_V_ONE", "TWO_V_TWO", "FOUR_V_FOUR"],
  BGMI: ["SOLO", "DUO", "SQUAD", "ONE_V_ONE", "TWO_V_TWO", "FOUR_V_FOUR"],
  VALORANT: ["ONE_V_ONE", "TWO_V_TWO", "FIVE_V_FIVE"],
};

const HEAD_TO_HEAD_SIZE: Partial<Record<MatchMode, number>> = {
  ONE_V_ONE: 1,
  TWO_V_TWO: 2,
  FOUR_V_FOUR: 4,
  FIVE_V_FIVE: 5,
};

/** Two sides, one winner: scored by win/loss (+ round difference), not placement and kills. */
export function isHeadToHead(mode: MatchMode): boolean {
  return HEAD_TO_HEAD_SIZE[mode] !== undefined;
}

/**
 * Players per registration slot. Solo and duo players register individually (one slot each,
 * duos pair up in the lobby — DECISIONS D3.1); squads and 2v2/4v4/5v5 register as a team; 1v1 individually.
 */
export function playersPerSlot(game: Game, mode: MatchMode): number {
  if (mode === "SOLO" || mode === "DUO") return 1;
  if (mode === "SQUAD") return game === "VALORANT" ? 5 : 4;
  return HEAD_TO_HEAD_SIZE[mode]!;
}

/** Whether registration is by a team captain (vs an individual player). */
export function isTeamMode(mode: MatchMode): boolean {
  return mode !== "SOLO" && mode !== "DUO" && mode !== "ONE_V_ONE";
}

/** Maximum players in one custom lobby (DECISIONS D2.3). Valorant is exactly 2 teams. */
export const LOBBY_CAPACITY: Record<Game, number> = { FREE_FIRE: 48, BGMI: 100, VALORANT: 10 };

/** "players" / "squads" / "teams": what one registration slot is in this mode. */
export function slotUnit(mode: MatchMode): string {
  if (!isTeamMode(mode)) return "players";
  return mode === "SQUAD" ? "squads" : "teams";
}

/**
 * Admin forms have no max field: this says what the capacity is.
 * "Full lobby: up to 12 squads (48 players)" or "2 sides: one 1v1 game".
 */
export function capacityText(game: Game, mode: MatchMode): string {
  if (isHeadToHead(mode)) return `2 sides: one ${MODE_LABEL[mode]} game`;
  const slots = maxSlotsFor(game, mode);
  const unit = slotUnit(mode);
  return unit === "players"
    ? `Full lobby: up to ${slots} players`
    : `Full lobby: up to ${slots} ${unit} (${LOBBY_CAPACITY[game]} players)`;
}

export function maxSlotsFor(game: Game, mode: MatchMode): number {
  if (isHeadToHead(mode)) return 2;
  return Math.floor(LOBBY_CAPACITY[game] / playersPerSlot(game, mode));
}
