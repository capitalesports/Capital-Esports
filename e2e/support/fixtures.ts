import type { Game, MatchMode } from "../../generated/prisma/client";
import { e2eDb } from "./db";

/**
 * An open scrim starting `minutesFromNow` from now, so specs don't depend on the seed's fixed IST times
 * (a run that crosses IST midnight would otherwise lose "today's" seeded matches).
 */
/**
 * Mark a UI-created player's email as verified. Verifying by code goes through the email stub (codes
 * print in the server console), which integration tests cover; e2e flows only need the result.
 */
export async function verifyEmailFor(phone10: string) {
  await e2eDb().user.update({
    where: { phone: `+91${phone10}` },
    data: { email: `ui${phone10}@test.in`, emailVerifiedAt: new Date() },
  });
}

export async function createOpenScrim(opts: {
  title: string;
  game: Game;
  mode: MatchMode;
  maxSlots: number;
  minutesFromNow?: number;
  startsAt?: Date;
  entryFeePaise?: number;
  prizePaise?: number;
}) {
  const db = e2eDb();
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const startsAt = opts.startsAt ?? new Date(Date.now() + (opts.minutesFromNow ?? 120) * 60_000);
  return db.match.create({
    data: {
      game: opts.game,
      kind: "SCRIM",
      mode: opts.mode,
      title: opts.title,
      startsAt,
      registrationClosesAt: new Date(startsAt.getTime() - 30 * 60_000),
      maxSlots: opts.maxSlots,
      entryFeePaise: opts.entryFeePaise ?? 0,
      prizePaise: opts.prizePaise ?? 0,
      status: "REGISTRATION_OPEN",
      createdById: admin.id,
    },
  });
}

/** IST calendar day key ("YYYY-MM-DD") `days` from now, and an instant at `hhmm` IST on it. */
export function istDay(days: number): string {
  return new Date(Date.now() + days * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
}

export function istAt(days: number, hhmm: string): Date {
  return new Date(`${istDay(days)}T${hhmm}:00+05:30`);
}

/** Monday (IST) `weeksAgo` weeks back, as the date value stored in Tournament.weekOf. */
export function istMondayWeeksAgo(weeksAgo: number): Date {
  const istNow = new Date(Date.now() + 330 * 60_000);
  const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() - daysSinceMonday - 7 * weeksAgo,
    ),
  );
}

/** A past tournament with a published podium (what "Last Week's Winners" on the home page shows). */
export async function createPublishedTournament(
  game: Game,
  weeksAgo: number,
  title: string,
  champion: string,
) {
  const weekOf = istMondayWeeksAgo(weeksAgo);
  // One tournament per game per week: reuse it when a retried test runs this again.
  const existing = await e2eDb().tournament.findFirst({ where: { game, weekOf } });
  if (existing) return existing;
  return e2eDb().tournament.create({
    data: {
      game,
      title,
      format: game === "VALORANT" ? "BRACKET" : "LOBBY_POINTS",
      mode: game === "VALORANT" ? "FIVE_V_FIVE" : "SQUAD",
      prizePoolPaise: 5_000_00,
      weekOf,
      startsAt: new Date(weekOf.getTime() + 5 * 86_400_000 + 14 * 3_600_000),
      winners: [
        {
          place: 1,
          name: champion,
          avatarUrl: null,
          prizePaise: 3_000_00,
          userIds: [],
          payeeUserId: "",
        },
        {
          place: 2,
          name: `${champion} II`,
          avatarUrl: null,
          prizePaise: 2_000_00,
          userIds: [],
          payeeUserId: "",
        },
      ],
      winnersPublishedAt: new Date(),
    },
  });
}
