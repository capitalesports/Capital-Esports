import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import type { Game } from "@/lib/games";
import { defaultPointsConfig, rankStandings, type PointsConfigValues } from "@/lib/points";

export const LEADERBOARD_PAGE_SIZE = 50;

export async function pointsConfigFor(tx: Tx, game: Game): Promise<PointsConfigValues> {
  const row = await tx.pointsConfig.findUnique({ where: { game } });
  if (!row) return defaultPointsConfig(game);
  return {
    placementPoints: (row.placementPoints as number[]).map(Number),
    killPoints: row.killPoints,
    winPoints: row.winPoints,
    lossPoints: row.lossPoints,
    tournamentMultiplier: row.tournamentMultiplier,
  };
}

/** Players who appear on leaderboards: not merged away and not currently banned. */
export function rankedUserWhere(now = new Date()): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    OR: [{ bannedAt: null }, { bannedUntil: { lte: now } }],
  };
}

/**
 * Rebuild the cached standings for a season from its PointsEntry rows.
 * Banned and merged-away accounts are left out (their points stay, and count again after an unban).
 */
export async function refreshLeaderboard(tx: Tx, seasonId: string): Promise<number> {
  const season = await tx.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: { game: true },
  });
  const entries = await tx.pointsEntry.findMany({
    where: { seasonId, user: rankedUserWhere() },
    select: {
      userId: true,
      points: true,
      kills: true,
      won: true,
      roundDiff: true,
      createdAt: true,
    },
  });
  const standings = rankStandings(season.game, entries);
  await tx.leaderboardSnapshot.deleteMany({ where: { seasonId } });
  if (standings.length) {
    const now = new Date();
    await tx.leaderboardSnapshot.createMany({
      data: standings.map((s) => ({ ...s, seasonId, updatedAt: now })),
    });
  }
  return standings.length;
}

export async function getActiveSeason(game: Game) {
  return db.season.findFirst({ where: { game, isActive: true }, orderBy: { startsAt: "desc" } });
}

/** One page of a season's standings with display names and current team for the game. */
export async function getStandingsPage(
  seasonId: string,
  game: Game,
  page = 1,
  pageSize = LEADERBOARD_PAGE_SIZE,
) {
  const p = Math.max(1, page);
  const [rows, total] = await Promise.all([
    db.leaderboardSnapshot.findMany({
      where: { seasonId },
      orderBy: [{ rank: "asc" }, { userId: "asc" }],
      skip: (p - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            teamMemberships: {
              where: { game, status: "CONFIRMED" },
              select: { team: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    }),
    db.leaderboardSnapshot.count({ where: { seasonId } }),
  ]);
  return {
    page: p,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
    rows: rows.map((r) => ({
      rank: r.rank,
      userId: r.userId,
      name: r.user.displayName ?? "Player",
      avatarUrl: r.user.avatarUrl,
      team: r.user.teamMemberships[0]?.team.name ?? null,
      points: r.points,
      matches: r.matches,
      wins: r.wins,
      kills: r.kills,
      roundDiff: r.roundDiff,
    })),
  };
}

export async function listPastSeasons(game: Game) {
  return db.season.findMany({
    where: { game, isActive: false },
    orderBy: { endsAt: "desc" },
    include: {
      results: {
        orderBy: { rank: "asc" },
        include: { user: { select: { id: true, displayName: true } } },
      },
    },
  });
}

/** A player's rank and totals in the active season of a game (share cards, player pages). */
export async function playerStanding(userId: string, game: Game) {
  const season = await getActiveSeason(game);
  if (!season) return null;
  const row = await db.leaderboardSnapshot.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId } },
  });
  return row
    ? { season, ...row }
    : { season, rank: null, points: 0, matches: 0, wins: 0, kills: 0, roundDiff: 0 };
}
