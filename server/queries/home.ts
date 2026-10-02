import "server-only";
import { db } from "@/server/db";
import { catchUpMatchStatuses } from "@/server/jobs/status-catch-up";
import { publicMatchSelect } from "@/server/queries/matches";
import { getActiveSeason, getStandingsPage } from "@/server/services/leaderboard";
import { getCurrentTournaments } from "@/server/services/tournament-queries";
import { GAMES, type Game } from "@/lib/games";
import type { MatchMode } from "@/lib/match-modes";
import { startOfIstDay } from "@/lib/time";

/** Real counts behind the hero stats (players with a profile, tournaments run, prize money offered). */
export async function getHomeStats() {
  const [players, tournaments, tournamentPrize, matchPrize] = await Promise.all([
    db.user.count({ where: { deletedAt: null, displayName: { not: null } } }),
    db.tournament.count(),
    db.tournament.aggregate({ _sum: { prizePoolPaise: true } }),
    db.match.aggregate({
      _sum: { prizePaise: true },
      where: { tournamentId: null, status: { not: "CANCELLED" } },
    }),
  ]);
  return {
    players,
    tournaments,
    prizePaise: (tournamentPrize._sum.prizePoolPaise ?? 0) + (matchPrize._sum.prizePaise ?? 0),
  };
}

/**
 * Home "Open & Upcoming Matches" row: every scrim and tournament match that hasn't finished, from
 * today on: registration open now, opening soon, closed and about to start, or live. Soonest first.
 */
export async function getOpenAndUpcomingMatches(now: Date) {
  await catchUpMatchStatuses();
  return db.match.findMany({
    where: {
      startsAt: { gte: startOfIstDay(now) },
      status: { in: ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] },
      isEntryList: false,
      parentMatchId: null,
    },
    orderBy: { startsAt: "asc" },
    take: 16,
    select: publicMatchSelect,
  });
}

export function getTodayMatches(now: Date) {
  return db.match.findMany({
    where: {
      startsAt: { gte: startOfIstDay(now), lt: startOfIstDay(now, 1) },
      status: { not: "CANCELLED" },
      isEntryList: false,
      parentMatchId: null,
    },
    orderBy: { startsAt: "asc" },
    take: 12,
    select: publicMatchSelect,
  });
}

export interface WeekTournament {
  game: Game;
  mode: MatchMode;
  id: string;
  title: string;
  prizePoolPaise: number;
  startsAt: Date;
  registrationOpen: boolean;
  /** Paid when signing up (0 = free). */
  entryFeePaise: number;
  /** Other current tournaments for the same game (other modes), shown as "+N more". */
  moreCount: number;
}

/**
 * The soonest current tournament per game (this week's or the next; cancelled ones excluded),
 * in game order; games without one are left out.
 */
export async function getWeekTournaments(now = new Date()): Promise<WeekTournament[]> {
  const list = await Promise.all(
    GAMES.map(async (game) => {
      const all = await getCurrentTournaments(game, now);
      const t = all[0];
      if (!t) return null;
      const entry = t.entryMatchId
        ? await db.match.findUnique({
            where: { id: t.entryMatchId },
            select: { status: true, entryFeePaise: true },
          })
        : null;
      return {
        game,
        mode: t.mode,
        id: t.id,
        title: t.title,
        prizePoolPaise: t.prizePoolPaise,
        startsAt: t.startsAt,
        registrationOpen: entry?.status === "REGISTRATION_OPEN",
        entryFeePaise: entry?.entryFeePaise ?? 0,
        moreCount: all.length - 1,
      };
    }),
  );
  return list.filter((t): t is WeekTournament => t !== null);
}

export const PREVIEW_ROWS = 5;

/** Top 5 of the current season for every game (empty list when no season or no points yet). */
export async function getLeaderboardPreview() {
  const entries = await Promise.all(
    GAMES.map(async (game) => {
      const season = await getActiveSeason(game);
      const board = season ? await getStandingsPage(season.id, game, 1, PREVIEW_ROWS) : null;
      return [game, board?.rows ?? []] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    Game,
    Awaited<ReturnType<typeof getStandingsPage>>["rows"]
  >;
}

export interface WinnerSlide {
  tournamentId: string;
  game: Game;
  title: string;
  weekOf: Date;
  /** Public fields only: no user IDs or payout details. */
  podium: { place: number; name: string; avatarUrl: string | null; prizePaise: number }[];
}

interface StoredWinner {
  place: number;
  name: string;
  avatarUrl: string | null;
  prizePaise: number;
}

/**
 * "Last Week's Winners": the most recent tournament with published winners for each game, newest first.
 * Empty until any tournament has published winners (the section is then hidden).
 */
export async function getLatestWinners(): Promise<WinnerSlide[]> {
  const rows = await db.tournament.findMany({
    where: { winnersPublishedAt: { not: null } },
    orderBy: [{ weekOf: "desc" }, { winnersPublishedAt: "desc" }],
    select: { id: true, game: true, title: true, weekOf: true, winners: true },
    take: 30,
  });
  const latest = new Map<Game, WinnerSlide>();
  for (const t of rows) {
    const winners = Array.isArray(t.winners) ? (t.winners as unknown as StoredWinner[]) : [];
    if (latest.has(t.game) || !winners.length) continue;
    latest.set(t.game, {
      tournamentId: t.id,
      game: t.game,
      title: t.title,
      weekOf: t.weekOf,
      podium: winners
        .map((w) => ({
          place: w.place,
          name: w.name,
          avatarUrl: w.avatarUrl ?? null,
          prizePaise: w.prizePaise ?? 0,
        }))
        .sort((a, b) => a.place - b.place)
        .slice(0, 3),
    });
  }
  return [...latest.values()];
}
