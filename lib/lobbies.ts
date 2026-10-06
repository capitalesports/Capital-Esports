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
 * Standalone scrims take unlimited entries and split into lobbies at close. Tournament matches,
 * bracket matches and the extra lobbies themselves keep their capacity.
 */
export function isOpenEntry(m: OpenEntryFields): boolean {
  return (
    !m.isEntryList && m.tournamentId === null && m.bracketRound === null && m.parentMatchId === null
  );
}

/**
 * Matches that take every registration: open-entry scrims and tournament sign-up lists (split into
 * lobbies or a bracket when registration closes, DECISIONS M50).
 */
export function takesEveryone(m: OpenEntryFields): boolean {
  return m.isEntryList || isOpenEntry(m);
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
  return {
    sizes: Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0)),
    unplaced: 0,
  };
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

/**
 * Duo tournaments (players register one by one and pair up in the lobby): lobbies are split in
 * pairs so partners stay together, `capacity` and `minSize` in players. An odd player out joins
 * the last lobby rather than being dropped.
 */
export function planDuoTournamentLobbies(
  players: number,
  capacity: number,
  minSize = MIN_TOURNAMENT_LOBBY,
): LobbyPlan {
  const pairs = planTournamentLobbies(
    Math.floor(players / 2),
    Math.floor(capacity / 2),
    Math.ceil(minSize / 2),
  );
  const sizes = pairs.sizes.map((s) => s * 2);
  let unplaced = pairs.unplaced * 2;
  if (players % 2) {
    if (sizes.length && sizes[sizes.length - 1]! < capacity) sizes[sizes.length - 1]! += 1;
    else if (sizes.length) unplaced += 1;
    else sizes.push(1);
  }
  return { sizes, unplaced };
}

/** How many lobbies the current entries would need (for "3 lobbies so far" on cards). */
export function lobbiesNeeded(entries: number, capacity: number, mode: MatchMode): number {
  return Math.max(1, planLobbies(entries, capacity, mode).sizes.length);
}

/** A tournament lobby needs at least this many entries, or it is not opened (DECISIONS M50). */
export const MIN_TOURNAMENT_LOBBY = 10;

/**
 * Tournament lobbies (Free Fire, BGMI, Valorant Deathmatch; DECISIONS M50): as few lobbies of at
 * most `capacity` as needed, balanced (52 in lobbies of 48 → 26 + 26). A lobby is never opened
 * with fewer than MIN_TOURNAMENT_LOBBY entries when that would split a group that could play
 * together: entries that don't fit are left unplaced (12 Deathmatch players → 10 play, 2 don't).
 * A tournament with fewer than the minimum in total still plays in one lobby. `minSize` is in
 * entries (squads: 10 players = 3 squads).
 */
export function planTournamentLobbies(
  entries: number,
  capacity: number,
  minSize = MIN_TOURNAMENT_LOBBY,
): LobbyPlan {
  if (entries <= 0) return { sizes: [], unplaced: 0 };
  const needed = Math.ceil(entries / capacity);
  const count = Math.max(1, Math.min(needed, Math.floor(entries / minSize)));
  if (count * capacity < entries) {
    return {
      sizes: Array.from({ length: count }, () => capacity),
      unplaced: entries - count * capacity,
    };
  }
  const base = Math.floor(entries / count);
  const extra = entries % count;
  return {
    sizes: Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0)),
    unplaced: 0,
  };
}
