import type { PrismaClient } from "../../generated/prisma/client";

/**
 * Extra e2e data on top of prisma/seed.ts: one confirmed Free Fire team and last week's Free Fire
 * tournament with published winners. Gives the prefetch audit an admin team and tournament detail page,
 * and the home page a "Last Week's Winners" slide. Uses last week so it never collides with the
 * this-week tournaments other specs create (one tournament per game per week).
 */
export async function seedE2eExtras(db: PrismaClient) {
  const captain = await db.user.create({
    data: {
      phone: "+919811100951",
      displayName: "Seed Captain",
      dateOfBirth: new Date("2000-01-01"),
      gameProfiles: { create: { game: "FREE_FIRE", gameId: "95100951" } },
    },
  });
  const mate = await db.user.create({
    data: {
      phone: "+919811100952",
      displayName: "Seed Mate",
      dateOfBirth: new Date("2000-01-01"),
      gameProfiles: { create: { game: "FREE_FIRE", gameId: "95100952" } },
    },
  });
  const team = await db.team.create({
    data: {
      game: "FREE_FIRE",
      name: "Seed Squad",
      captainId: captain.id,
      members: {
        create: [
          { userId: captain.id, game: "FREE_FIRE", status: "CONFIRMED", confirmedAt: new Date() },
          { userId: mate.id, game: "FREE_FIRE", status: "CONFIRMED", confirmedAt: new Date() },
        ],
      },
    },
  });

  // Monday 00:00 IST of last week (weekOf is a date column).
  const istNow = new Date(Date.now() + 330 * 60_000);
  const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
  const lastMonday = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() - daysSinceMonday - 7,
    ),
  );
  const tournament = await db.tournament.create({
    data: {
      game: "FREE_FIRE",
      title: "Seed Last Week Cup",
      format: "LOBBY_POINTS",
      mode: "SQUAD",
      prizePoolPaise: 10_000_00,
      weekOf: lastMonday,
      startsAt: new Date(lastMonday.getTime() + 5 * 86_400_000 + 14 * 3_600_000),
      winners: [
        {
          place: 1,
          name: "Seed Squad",
          avatarUrl: null,
          prizePaise: 6_000_00,
          userIds: [captain.id, mate.id],
          payeeUserId: captain.id,
        },
        {
          place: 2,
          name: "Runner Squad",
          avatarUrl: null,
          prizePaise: 3_000_00,
          userIds: [],
          payeeUserId: captain.id,
        },
        {
          place: 3,
          name: "Third Squad",
          avatarUrl: null,
          prizePaise: 1_000_00,
          userIds: [],
          payeeUserId: captain.id,
        },
      ],
      winnersPublishedAt: new Date(),
    },
  });
  return { team, tournament };
}
