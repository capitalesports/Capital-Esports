import "server-only";
import { db } from "@/server/db";
import { GAMES, type Game } from "@/lib/games";

/** The user's points in the active season of each game. */
export async function myPointsByGame(
  userId: string,
): Promise<{ game: Game; points: number; matches: number }[]> {
  const seasons = await db.season.findMany({
    where: { isActive: true },
    select: { id: true, game: true },
  });
  const sums = await db.pointsEntry.groupBy({
    by: ["seasonId"],
    where: { userId, seasonId: { in: seasons.map((s) => s.id) } },
    _sum: { points: true },
    _count: { _all: true },
  });
  return GAMES.map((game) => {
    const season = seasons.find((s) => s.game === game);
    const row = sums.find((s) => s.seasonId === season?.id);
    return { game, points: row?._sum.points ?? 0, matches: row?._count._all ?? 0 };
  });
}

/** 1-based leaderboard page holding a row at 0-based `position` (the table orders by rank, then user id). */
export function pageForPosition(position: number, pageSize: number): number {
  return Math.floor(Math.max(0, position) / pageSize) + 1;
}

/** The user's row in a season's cached standings and the page it is on, or null if unranked. */
export async function myStandingPage(seasonId: string, userId: string, pageSize: number) {
  const mine = await db.leaderboardSnapshot.findUnique({
    where: { seasonId_userId: { seasonId, userId } },
  });
  if (!mine) return null;
  const ahead = await db.leaderboardSnapshot.count({
    where: {
      seasonId,
      OR: [{ rank: { lt: mine.rank } }, { rank: mine.rank, userId: { lt: userId } }],
    },
  });
  return { ...mine, page: pageForPosition(ahead, pageSize) };
}

/** Top N of the active season's cached leaderboard. */
export async function topPlayers(game: Game, take = 10) {
  const season = await db.season.findFirst({ where: { game, isActive: true } });
  if (!season) return [];
  const rows = await db.leaderboardSnapshot.findMany({
    where: { seasonId: season.id },
    orderBy: [{ rank: "asc" }, { userId: "asc" }],
    take,
    include: { user: { select: { displayName: true } } },
  });
  return rows.map((r) => ({
    rank: r.rank,
    userId: r.userId,
    name: r.user.displayName ?? "Player",
    points: r.points,
  }));
}
