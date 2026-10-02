/**
 * Open entry (DECISIONS M11): scrims take every registration; when registration closes the entries
 * are split into as many lobbies as needed. Pure helpers, shared by the server and the UI.
 */
import { isHeadToHead, type MatchMode } from "./match-modes";

/** The fields that decide whether a match takes unlimited entries. */
export interface OpenEntryFields {
  isEntryList: boolean;
  tournamentId: string | null;
  bracketRound: number | null;
  parentMatchId: string | null;
}

/**
 * Standalone scrims take unlimited entries. Tournament sign-ups (a bracket needs exactly 8 or
 * 16), tournament matches, bracket matches and the extra lobbies themselves keep their capacity.
 */
export function isOpenEntry(m: OpenEntryFields): boolean {
  return !m.isEntryList && m.tournamentId === null && m.bracketRound === null && m.parentMatchId === null;
}

export interface LobbyPlan {
  /** Entries per lobby, in lobby order (sign-up order fills lobby 1 first). */
  sizes: number[];
  /** Entries left without a side (head-to-head with an odd count): the admin decides. */
  unplaced: number;
}

/**
 * How `entries` split into lobbies of at most `capacity`. Lobby modes are balanced (sizes differ by
 * at most one: 50 in lobbies of 48 → 25 + 25). Head-to-head pairs sides into games of 2; an odd
 * one out stays unplaced.
 */
export function planLobbies(entries: number, capacity: number, mode: MatchMode): LobbyPlan {
  if (entries <= 0) return { sizes: [], unplaced: 0 };
  if (isHeadToHead(mode)) {
    // A single side has nobody to play: it stays one "game" (the minimum-entries rule cancels it).
    if (entries < 2) return { sizes: [entries], unplaced: 0 };
    const games = Math.floor(entries / 2);
    return { sizes: Array.from({ length: games }, () => 2), unplaced: entries % 2 };
  }
  if (entries <= capacity) return { sizes: [entries], unplaced: 0 };
  const count = Math.ceil(entries / capacity);
  const base = Math.floor(entries / count);
  const extra = entries % count;
  return { sizes: Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0)), unplaced: 0 };
}

/** "Lobby" for battle-royale lobbies, "Game" for head-to-head. */
export function lobbyWord(mode: MatchMode): "Lobby" | "Game" {
  return isHeadToHead(mode) ? "Game" : "Lobby";
}

/** "lobby"/"lobbies" or "game"/"games" for a count. */
export function lobbyNoun(mode: MatchMode, count: number): string {
  if (isHeadToHead(mode)) return count === 1 ? "game" : "games";
  return count === 1 ? "lobby" : "lobbies";
}

/** How many lobbies the current entries would need (for "3 lobbies so far" on cards). */
export function lobbiesNeeded(entries: number, capacity: number, mode: MatchMode): number {
  return Math.max(1, planLobbies(entries, capacity, mode).sizes.length);
}
