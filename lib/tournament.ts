/**
 * Tournament logic (pure). Battle royale tournaments sum lobby points across linked matches;
 * Valorant tournaments are single-elimination brackets of 8 or 16 teams.
 */
import { MATCH_MODES, type MatchMode } from "./match-modes";
import { IST_OFFSET_MINUTES } from "./time";

/** Heading for the sign-up count: players register alone in solo/duo/1v1, squads and teams otherwise. */
export function entryCountLabel(mode: MatchMode): "Players" | "Squads" | "Teams" {
  if (mode === "SOLO" || mode === "DUO" || mode === "ONE_V_ONE") return "Players";
  return mode === "SQUAD" ? "Squads" : "Teams";
}

/** Parse `?mode=` against the modes on offer; anything unknown (or missing) means "the first one". */
export function pickByMode<T extends { mode: MatchMode }>(
  list: T[],
  param: string | string[] | undefined,
): T | undefined {
  const raw = Array.isArray(param) ? param[0] : param;
  const mode = (MATCH_MODES as readonly string[]).includes(raw ?? "") ? raw : undefined;
  return list.find((t) => t.mode === mode) ?? list[0];
}

export const BRACKET_SIZES = [8, 16] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];

/** Monday of the IST week containing `date`, as a UTC-midnight date (for the `weekOf` column). */
export function mondayOfIstWeek(date: Date): Date {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const day = ist.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - back));
}

// ---------------------------------------------------------------------------
// Lobby points (Free Fire / BGMI)
// ---------------------------------------------------------------------------

export interface LobbyResult {
  /** Stable key for the entrant across matches: team id for squads, user id for solo. */
  unitKey: string;
  name: string;
  matchId: string;
  placement: number;
  kills: number;
  points: number;
}

export interface LobbyStanding {
  rank: number;
  unitKey: string;
  name: string;
  points: number;
  kills: number;
  wins: number;
  matches: number;
  bestPlacement: number;
}

/** Cumulative standings across a tournament's lobby matches. Ties: wins, kills, best placement. */
export function lobbyStandings(results: LobbyResult[]): LobbyStanding[] {
  const by = new Map<string, Omit<LobbyStanding, "rank">>();
  for (const r of results) {
    const s = by.get(r.unitKey) ?? {
      unitKey: r.unitKey,
      name: r.name,
      points: 0,
      kills: 0,
      wins: 0,
      matches: 0,
      bestPlacement: Infinity,
    };
    s.points += r.points;
    s.kills += r.kills;
    s.wins += r.placement === 1 ? 1 : 0;
    s.matches += 1;
    s.bestPlacement = Math.min(s.bestPlacement, r.placement);
    by.set(r.unitKey, s);
  }
  const cmp = (a: Omit<LobbyStanding, "rank">, b: Omit<LobbyStanding, "rank">) =>
    b.points - a.points ||
    b.wins - a.wins ||
    b.kills - a.kills ||
    a.bestPlacement - b.bestPlacement;
  const sorted = [...by.values()].sort(cmp);
  const out: LobbyStanding[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    out.push({ ...s, rank: prev && cmp(prev, s) === 0 ? prev.rank : i + 1 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Single-elimination bracket (Valorant)
// ---------------------------------------------------------------------------

export function isBracketSize(n: number): n is BracketSize {
  return (BRACKET_SIZES as readonly number[]).includes(n);
}

export function roundCount(size: BracketSize): number {
  return Math.log2(size);
}

/**
 * Standard seeding order so the top seeds meet as late as possible.
 * 8 -> [1,8,4,5,2,7,3,6]; 16 -> [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11].
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

/** Round-1 pairings from entrants listed in seed order (index 0 = seed 1). */
export function firstRoundPairs<T>(seeded: T[]): [T, T][] {
  if (!isBracketSize(seeded.length)) throw new Error("Bracket needs exactly 8 or 16 teams");
  const order = seedOrder(seeded.length);
  const pairs: [T, T][] = [];
  for (let i = 0; i < order.length; i += 2)
    pairs.push([seeded[order[i]! - 1]!, seeded[order[i + 1]! - 1]!]);
  return pairs;
}

/** Where the winner of (round, index) plays next. */
export function nextSlot(
  round: number,
  index: number,
): { round: number; index: number; side: 0 | 1 } {
  return { round: round + 1, index: Math.floor(index / 2), side: (index % 2) as 0 | 1 };
}

/** The other match that feeds the same next-round match. */
export function siblingIndex(index: number): number {
  return index ^ 1;
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round of ${2 ** (fromEnd + 1)}`;
}

export interface BracketMatchResult {
  round: number;
  index: number;
  winnerKey: string;
  loserKey: string;
  loserRoundDiff: number;
}

/**
 * Final placements from a finished bracket: 1st final winner, 2nd final loser, 3rd the semifinal
 * loser with the better round difference (no third-place match).
 */
export function bracketPodium(matches: BracketMatchResult[], totalRounds: number): string[] {
  const final = matches.find((m) => m.round === totalRounds);
  if (!final) return [];
  const semis = matches
    .filter((m) => m.round === totalRounds - 1)
    .sort((a, b) => b.loserRoundDiff - a.loserRoundDiff);
  return [final.winnerKey, final.loserKey, ...(semis[0] ? [semis[0].loserKey] : [])];
}
