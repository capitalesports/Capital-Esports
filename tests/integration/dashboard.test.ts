import { beforeEach, describe, expect, it } from "vitest";
import { getMatchHistory, getMyWinnings, getResultsToSubmit } from "@/server/queries/dashboard";
import { myStandingPage, pageForPosition } from "@/server/queries/points";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let adminId: string;

beforeEach(async () => {
  await resetDb();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

async function register(matchId: string, userId: string, status: "CONFIRMED" | "NO_SHOW" = "CONFIRMED") {
  return testDb().registration.create({ data: { matchId, userId, status, position: 1 } });
}

describe("getResultsToSubmit", () => {
  it("lists RESULTS_PENDING matches with my confirmed entry and no submitted result", async () => {
    const u = await createPlayer();
    const pending = await createMatch(adminId, { status: "RESULTS_PENDING", title: "Needs result" });
    const done = await createMatch(adminId, { status: "RESULTS_PENDING", title: "Submitted" });
    const live = await createMatch(adminId, { status: "LIVE" });
    await register(pending.id, u.id);
    const r = await register(done.id, u.id);
    await register(live.id, u.id);
    await testDb().result.create({
      data: { matchId: done.id, registrationId: r.id, userId: u.id, placement: 1, kills: 2 },
    });
    const rows = await getResultsToSubmit(u.id);
    expect(rows.map((x) => x.match.title)).toEqual(["Needs result"]);
  });
});

describe("getMatchHistory", () => {
  it("shows mode, approved result and points, newest first", async () => {
    const u = await createPlayer();
    const season = await testDb().season.create({
      data: { game: "FREE_FIRE", name: "S1", startsAt: new Date(0), endsAt: new Date(Date.now() + 1e10), isActive: true },
    });
    const older = await createMatch(adminId, { status: "COMPLETED", mode: "ONE_V_ONE", startsAt: new Date(Date.now() - 2 * 864e5) });
    const newer = await createMatch(adminId, { status: "COMPLETED", mode: "SOLO", startsAt: new Date(Date.now() - 864e5) });
    const r1 = await register(older.id, u.id);
    const r2 = await register(newer.id, u.id);
    await testDb().result.createMany({
      data: [
        { matchId: older.id, registrationId: r1.id, userId: u.id, won: true, approvedAt: new Date() },
        { matchId: newer.id, registrationId: r2.id, userId: u.id, placement: 3, kills: 4, approvedAt: new Date() },
      ],
    });
    await testDb().pointsEntry.create({
      data: { seasonId: season.id, userId: u.id, matchId: newer.id, points: 12, reason: "placement", placement: 3, kills: 4 },
    });
    const rows = await getMatchHistory(u.id);
    expect(rows.map((r) => r.match.id)).toEqual([newer.id, older.id]);
    expect(rows[0]).toMatchObject({ placement: 3, kills: 4, points: 12 });
    expect(rows[0]!.match.mode).toBe("SOLO");
    expect(rows[1]).toMatchObject({ won: true, points: null });
    expect(await getMatchHistory(u.id, { excludeMatchIds: [newer.id] })).toHaveLength(1);
  });
});

describe("myStandingPage", () => {
  it("finds the page holding my row (rank, then user id order)", async () => {
    const season = await testDb().season.create({
      data: { game: "BGMI", name: "S", startsAt: new Date(0), endsAt: new Date(Date.now() + 1e10), isActive: true },
    });
    const users = [];
    for (let i = 0; i < 5; i++) users.push(await createUser());
    await testDb().leaderboardSnapshot.createMany({
      data: users.map((u, i) => ({
        seasonId: season.id,
        userId: u.id,
        rank: Math.min(i + 1, 4), // the last two share rank 4
        points: 100 - i,
        matches: 1,
        wins: 0,
        kills: 0,
        roundDiff: 0,
        lastScoredAt: new Date(),
      })),
    });
    expect(pageForPosition(0, 2)).toBe(1);
    expect(pageForPosition(2, 2)).toBe(2);
    expect((await myStandingPage(season.id, users[0]!.id, 2))?.page).toBe(1);
    expect((await myStandingPage(season.id, users[2]!.id, 2))?.page).toBe(2);
    const tied = [users[3]!.id, users[4]!.id].sort();
    expect((await myStandingPage(season.id, tied[0]!, 2))?.page).toBe(2);
    expect((await myStandingPage(season.id, tied[1]!, 2))?.page).toBe(3);
    expect(await myStandingPage(season.id, adminId, 2)).toBeNull();
  });
});

describe("getMyWinnings", () => {
  it("lists tournament, season and scrim prizes without voided ones; totals paid", async () => {
    const u = await createPlayer();
    const m = await createMatch(adminId, { status: "COMPLETED", title: "Prize scrim" });
    const season = await testDb().season.create({
      data: { game: "FREE_FIRE", name: "S1", startsAt: new Date(0), endsAt: new Date() },
    });
    await testDb().payout.createMany({
      data: [
        { userId: u.id, matchId: m.id, place: 1, amountPaise: 20000, status: "SUCCESS" },
        { userId: u.id, seasonId: season.id, place: 2, amountPaise: 50000, status: "PENDING" },
        { userId: u.id, tournamentId: "t-void", place: 1, amountPaise: 99900, status: "PENDING", voidedAt: new Date() },
      ],
    });
    const { rows, paidPaise } = await getMyWinnings(u.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title).sort()).toEqual(["Prize scrim", "S1 (season)"]);
    expect(paidPaise).toBe(20000);
  });
});
