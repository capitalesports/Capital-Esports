/**
 * Points engine (docs/SPEC.md "Points, leaderboards and seasons"). Pure functions only.
 * Lobby modes (solo/duo/squad): placement points (1st highest) + points per kill.
 * Head-to-head modes (1v1…5v5, all of Valorant): win/loss points.
 * Tournament matches multiply by the configured tournament multiplier.
 */
import { isBattleRoyale, type Game } from "./games";
import { isHeadToHead, type MatchMode } from "./match-modes";

export interface PointsConfigValues {
  /** index 0 = 1st place */
  placementPoints: number[];
  killPoints: number;
  winPoints: number;
  lossPoints: number;
  tournamentMultiplier: number;
}

/** Seed values: 1st 15, 2nd 12, 3rd 10, 4th 8, 5th 6, 6th 4, 7th–8th 2, 9th–12th 1; 1 per kill; Valorant 3/0; ×2 tournament. */
export const DEFAULT_BR_PLACEMENT = [15, 12, 10, 8, 6, 4, 2, 2, 1, 1, 1, 1];

export function defaultPointsConfig(game: Game): PointsConfigValues {
  return {
    placementPoints: isBattleRoyale(game) ? [...DEFAULT_BR_PLACEMENT] : [],
    killPoints: isBattleRoyale(game) ? 1 : 0,
    winPoints: 3,
    lossPoints: 0,
    tournamentMultiplier: 2,
  };
}

export function placementPoints(config: PointsConfigValues, placement: number): number {
  if (!Number.isInteger(placement) || placement < 1) return 0;
  return config.placementPoints[placement - 1] ?? 0;
}

export interface BrResult {
  placement: number;
  kills: number;
}

export interface ValorantResult {
  won: boolean;
  roundDiff: number;
}

/**
 * Lobby scoring needs a placement table. Valorant's config has none (it scores wins), so its
 * Deathmatch uses the default table and 1 point per kill (DECISIONS M50).
 */
export function lobbyScoring(config: PointsConfigValues): PointsConfigValues {
  if (config.placementPoints.length) return config;
  return {
    ...config,
    placementPoints: [...DEFAULT_BR_PLACEMENT],
    killPoints: config.killPoints || 1,
  };
}

export function brPoints(config: PointsConfigValues, r: BrResult, isTournament: boolean): number {
  const scoring = lobbyScoring(config);
  const base = placementPoints(scoring, r.placement) + Math.max(0, r.kills) * scoring.killPoints;
  return isTournament ? base * config.tournamentMultiplier : base;
}

export function valorantPoints(
  config: PointsConfigValues,
  r: ValorantResult,
  isTournament: boolean,
): number {
  const base = r.won ? config.winPoints : config.lossPoints;
  return isTournament ? base * config.tournamentMultiplier : base;
}

export interface ScoredUnit {
  registrationId: string;
  /** Everyone who played for this registration (solo player, or the confirmed squad). */
  playerIds: string[];
  placement: number | null;
  kills: number | null;
  won: boolean | null;
  roundDiff: number | null;
}

export interface PointsRow {
  userId: string;
  points: number;
  placement: number | null;
  kills: number;
  won: boolean;
  roundDiff: number;
  reason: string;
}

/**
 * One PointsEntry per player. Team matches: every confirmed member receives the team's points
 * (and the team's kills/wins, so tiebreakers are consistent within a team).
 */
export function pointsForMatch(
  mode: MatchMode,
  kind: "SCRIM" | "TOURNAMENT",
  config: PointsConfigValues,
  units: ScoredUnit[],
): PointsRow[] {
  const tournament = kind === "TOURNAMENT";
  const reason = tournament ? "tournament" : "scrim";
  return units.flatMap((u) => {
    if (!isHeadToHead(mode)) {
      const placement = u.placement ?? 0;
      const kills = u.kills ?? 0;
      const points = brPoints(config, { placement, kills }, tournament);
      return u.playerIds.map((userId) => ({
        userId,
        points,
        placement,
        kills,
        won: placement === 1,
        roundDiff: 0,
        reason,
      }));
    }
    const won = !!u.won;
    const roundDiff = u.roundDiff ?? 0;
    const points = valorantPoints(config, { won, roundDiff }, tournament);
    return u.playerIds.map((userId) => ({
      userId,
      points,
      placement: won ? 1 : 2,
      kills: 0,
      won,
      roundDiff,
      reason,
    }));
  });
}

/**
 * How many entries may share one lobby placement. Duo partners register individually and both
 * report their team's placement, so DUO allows 2; SOLO and SQUAD (one entry per squad) allow 1.
 */
export function entriesPerPlacement(mode: MatchMode): number {
  return mode === "DUO" ? 2 : 1;
}

/** BR placements claimed by more entries than allowed (moderator must resolve before approving). */
export function duplicatePlacements(placements: (number | null)[], perPlacement = 1): number[] {
  const seen = new Map<number, number>();
  for (const p of placements) if (p !== null) seen.set(p, (seen.get(p) ?? 0) + 1);
  return [...seen.entries()]
    .filter(([, n]) => n > perPlacement)
    .map(([p]) => p)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface EntryForStanding {
  userId: string;
  points: number;
  kills: number;
  won: boolean;
  roundDiff: number;
  createdAt: Date;
}

export interface Standing {
  rank: number;
  userId: string;
  points: number;
  matches: number;
  wins: number;
  kills: number;
  roundDiff: number;
  lastScoredAt: Date;
}

/** Aggregate a season's PointsEntry rows per player. */
export function aggregate(entries: EntryForStanding[]): Omit<Standing, "rank">[] {
  const by = new Map<string, Omit<Standing, "rank">>();
  for (const e of entries) {
    const s = by.get(e.userId) ?? {
      userId: e.userId,
      points: 0,
      matches: 0,
      wins: 0,
      kills: 0,
      roundDiff: 0,
      lastScoredAt: e.createdAt,
    };
    s.points += e.points;
    s.matches += 1;
    s.wins += e.won ? 1 : 0;
    s.kills += e.kills;
    s.roundDiff += e.roundDiff;
    if (e.createdAt > s.lastScoredAt) s.lastScoredAt = e.createdAt;
    by.set(e.userId, s);
  }
  return [...by.values()];
}

/**
 * Tiebreakers. BR: points, then most wins, then most kills, then earlier achievement
 * (reached the total first). Valorant: points, then most wins, then round difference.
 */
export function compareStandings(game: Game) {
  return (a: Omit<Standing, "rank">, b: Omit<Standing, "rank">): number => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (isBattleRoyale(game)) {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.lastScoredAt.getTime() - b.lastScoredAt.getTime();
    }
    if (b.roundDiff !== a.roundDiff) return b.roundDiff - a.roundDiff;
    return a.lastScoredAt.getTime() - b.lastScoredAt.getTime();
  };
}

/** Rank players 1..n; players still tied after every tiebreaker share a rank. */
export function rankStandings(game: Game, entries: EntryForStanding[]): Standing[] {
  const cmp = compareStandings(game);
  const sorted = aggregate(entries).sort(cmp);
  const out: Standing[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    const tied = prev && cmp(prev, s) === 0;
    out.push({ ...s, rank: tied ? prev.rank : i + 1 });
  });
  return out;
}

export const STRIKES_FOR_BLOCK = 3;
export const STRIKE_BLOCK_DAYS = 7;
export const DISPUTE_WINDOW_MINUTES = 120;

/** Can this actor reopen approved results now? Moderators within 2 h of approval; admins any time. */
export function canReopenResults(
  role: "PLAYER" | "MODERATOR" | "ADMIN",
  approvedAt: Date | null,
  now: Date,
): boolean {
  if (role === "ADMIN") return true;
  if (role !== "MODERATOR" || !approvedAt) return false;
  return now.getTime() - approvedAt.getTime() <= DISPUTE_WINDOW_MINUTES * 60_000;
}

/** Disputes may be opened by players within 2 hours of results being approved. */
export function isWithinDisputeWindow(approvedAt: Date | null, now: Date): boolean {
  return !!approvedAt && now.getTime() - approvedAt.getTime() <= DISPUTE_WINDOW_MINUTES * 60_000;
}
