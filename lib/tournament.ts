/**
 * Tournament logic (pure). Lobby tournaments (Free Fire, BGMI, Valorant Deathmatch) sum points
 * across their lobby matches; head-to-head tournaments are single-elimination brackets with byes.
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

/**
 * Pick this week's tournament from the URL: `?t=<id>` (several can share a game and mode), else
 * `?mode=` (older links), else the first one.
 */
export function pickTournament<T extends { id: string; mode: MatchMode }>(
  list: T[],
  query: { t?: string | string[]; mode?: string | string[] },
): T | undefined {
  const id = Array.isArray(query.t) ? query.t[0] : query.t;
  return list.find((t) => t.id === id) ?? pickByMode(list, query.mode);
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
// Single-elimination bracket with byes (head-to-head modes; DECISIONS M50)
// ---------------------------------------------------------------------------

/**
 * Pair one round's entrants in order (1 v 2, 3 v 4, …). With an odd count the last entrant has
 * no opponent: it gets a bye and goes straight to the next round.
 */
export function pairRound<T>(entrants: T[]): { pairs: [T, T][]; bye: T | null } {
  const pairs: [T, T][] = [];
  for (let i = 0; i + 1 < entrants.length; i += 2) pairs.push([entrants[i]!, entrants[i + 1]!]);
  return { pairs, bye: entrants.length % 2 ? entrants[entrants.length - 1]! : null };
}

/**
 * Who plays the next round: the entrant that had a bye goes first (so it meets a winner and can
 * never get two byes in a row), then the winners in match order.
 */
export function nextRoundEntrants<T>(winners: T[], bye: T | null): T[] {
  return bye === null ? winners : [bye, ...winners];
}

/**
 * Is game `index` of `round` void (DECISIONS M73)? A bracket game cancelled without a winner
 * (both sides disqualified or absent): nobody goes through, and the next round is one entrant
 * shorter. Defaults to "no void games".
 */
export type IsVoid = (round: number, index: number) => boolean;
const noVoids: IsVoid = () => false;

export interface BracketRoundState<K> {
  round: number;
  entrants: K[];
  pairs: [K, K][];
  bye: K | null;
  /** Winner of each pair (null = not decided yet, or void). */
  winners: (K | null)[];
  /** Pairs whose game is void: nobody goes through. */
  voided: boolean[];
  complete: boolean;
}

/**
 * Replay a bracket from its round-1 entrants (sign-up order) and the decided matches: every round
 * up to the first one still being played. A winner that is not one of the pair counts as undecided.
 * Byes are never stored; they follow from the entrant count.
 */
export function walkBracket<K>(
  entrants: K[],
  winnerOf: (round: number, index: number) => K | null,
  isVoid: IsVoid = noVoids,
): BracketRoundState<K>[] {
  const rounds: BracketRoundState<K>[] = [];
  let left = entrants;
  while (left.length >= 2) {
    const round = rounds.length + 1;
    const { pairs, bye } = pairRound(left);
    const voided = pairs.map((_, i) => isVoid(round, i));
    const winners = pairs.map(([a, b], i) => {
      if (voided[i]) return null;
      const w = winnerOf(round, i);
      return w === a || w === b ? w : null;
    });
    const complete = winners.every((w, i) => w !== null || voided[i]);
    rounds.push({ round, entrants: left, pairs, bye, winners, voided, complete });
    if (!complete) break;
    left = nextRoundEntrants(
      winners.filter((w): w is K => w !== null),
      bye,
    );
  }
  return rounds;
}

/**
 * Who stands in each slot of every round so far (DECISIONS M66): round 1 is the sign-up order; a
 * winner fills their next-round slot the moment their game is decided, even while the other side is
 * still playing (null = not known yet). Same pairing as walkBracket: consecutive pairs; the last of
 * an odd count has a bye and goes first in the next round.
 */
export function bracketSlots<K>(
  entrants: K[],
  winnerOf: (round: number, index: number) => K | null,
  isVoid: IsVoid = noVoids,
): (K | null)[][] {
  const rounds: (K | null)[][] = [];
  let left: (K | null)[] = entrants;
  for (let round = 1; left.length >= 2; round++) {
    rounds.push(left);
    const winners: (K | null)[] = [];
    for (let i = 0; i + 1 < left.length; i += 2) {
      // A void game sends nobody on: the next round is one slot shorter (M73).
      if (isVoid(round, i / 2)) continue;
      const a = left[i] ?? null;
      const b = left[i + 1] ?? null;
      const w = a === null || b === null ? null : winnerOf(round, i / 2);
      winners.push(w !== null && (w === a || w === b) ? w : null);
    }
    left = left.length % 2 ? [left[left.length - 1] ?? null, ...winners] : winners;
  }
  return rounds;
}

/** Every bracket game whose two sides are known: it can be created and played now (M66). */
export function readyBracketPairs<K>(
  entrants: K[],
  winnerOf: (round: number, index: number) => K | null,
  isVoid: IsVoid = noVoids,
): { round: number; index: number; pair: [K, K] }[] {
  return bracketSlots(entrants, winnerOf, isVoid).flatMap((slots, r) => {
    const out: { round: number; index: number; pair: [K, K] }[] = [];
    for (let i = 0; i + 1 < slots.length; i += 2) {
      if (isVoid(r + 1, i / 2)) continue;
      const a = slots[i] ?? null;
      const b = slots[i + 1] ?? null;
      if (a !== null && b !== null) out.push({ round: r + 1, index: i / 2, pair: [a, b] });
    }
    return out;
  });
}

export interface RoundShape {
  round: number;
  matches: number;
  /** 1 when an entrant skips this round, else 0. */
  byes: number;
}

/**
 * The whole bracket for `entrants` (9 → 4 matches + 1 bye, 2 + 1, 1 + 1, then the final), used to
 * draw rounds that are not played yet. Empty for fewer than 2 entrants.
 */
export function bracketShape(entrants: number): RoundShape[] {
  const rounds: RoundShape[] = [];
  let left = entrants;
  while (left >= 2) {
    const matches = Math.floor(left / 2);
    const byes = left % 2;
    rounds.push({ round: rounds.length + 1, matches, byes });
    left = matches + byes;
  }
  return rounds;
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
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
