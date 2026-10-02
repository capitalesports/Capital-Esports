import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHomeStats,
  getLeaderboardPreview,
  getOpenAndUpcomingMatches,
  getTodayMatches,
  getWeekTournaments,
  PREVIEW_ROWS,
} from "@/server/queries/home";
import { mondayOfIstWeek } from "@/lib/tournament";
import { addDays } from "@/lib/time";
import { createMatch, createUser, resetDb, testDb } from "../helpers/db";

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
}));

beforeEach(async () => {
  await resetDb();
});

describe("home page queries", () => {
  it("counts real players, tournaments and prize money (no double counting tournament matches)", async () => {
    const admin = await createUser({ role: "ADMIN", displayName: "Admin" });
    await createUser({ displayName: "Player One" });
    const noProfile = await createUser(); // no profile yet: not counted
    await testDb().user.update({ where: { id: noProfile.id }, data: { displayName: null } });
    const merged = await createUser({ displayName: "Merged" });
    await testDb().user.update({ where: { id: merged.id }, data: { deletedAt: new Date() } });

    const t = await testDb().tournament.create({
      data: {
        game: "BGMI",
        weekOf: mondayOfIstWeek(new Date()),
        startsAt: addDays(new Date(), 1),
        title: "Cup",
        format: "LOBBY_POINTS",
        mode: "SQUAD",
        prizePoolPaise: 300_000,
      },
    });
    const scrim = await createMatch(admin.id);
    await testDb().match.update({ where: { id: scrim.id }, data: { prizePaise: 50_000 } });
    const linked = await createMatch(admin.id, {
      tournamentId: t.id,
      kind: "TOURNAMENT",
      game: "BGMI",
    });
    await testDb().match.update({ where: { id: linked.id }, data: { prizePaise: 99_900 } });
    const cancelled = await createMatch(admin.id, { status: "CANCELLED" });
    await testDb().match.update({ where: { id: cancelled.id }, data: { prizePaise: 70_000 } });

    expect(await getHomeStats()).toEqual({ players: 2, tournaments: 1, prizePaise: 350_000 });
  });

  it("lists today's matches only, and this week's tournament per game with its registration state", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const now = new Date();
    await createMatch(admin.id, { title: "Later today", startsAt: now });
    await createMatch(admin.id, { title: "Next week", startsAt: addDays(now, 7) });
    const today = await getTodayMatches(now);
    expect(today.map((m) => m.title)).toContain("Later today");
    expect(today.map((m) => m.title)).not.toContain("Next week");

    // The home row shows everything still open or coming up, not just today.
    await createMatch(admin.id, { title: "Opens soon", status: "UPCOMING", startsAt: addDays(now, 2) });
    await createMatch(admin.id, { title: "Finished", status: "COMPLETED", startsAt: addDays(now, 1) });
    await createMatch(admin.id, { title: "Called off", status: "CANCELLED", startsAt: addDays(now, 1) });
    const parent = await createMatch(admin.id, { title: "Split scrim", startsAt: addDays(now, 1) });
    const lobby2 = await createMatch(admin.id, { title: "Split scrim — Lobby 2", startsAt: addDays(now, 1) });
    await testDb().match.update({ where: { id: lobby2.id }, data: { parentMatchId: parent.id, lobbyNumber: 2 } });
    const row = (await getOpenAndUpcomingMatches(now)).map((m) => m.title);
    expect(row).toEqual(expect.arrayContaining(["Later today", "Next week", "Opens soon", "Split scrim"]));
    expect(row).not.toContain("Finished");
    expect(row).not.toContain("Called off");
    expect(row).not.toContain("Split scrim — Lobby 2");

    const entry = await createMatch(admin.id, {
      game: "VALORANT",
      mode: "FIVE_V_FIVE",
      kind: "TOURNAMENT",
    });
    await testDb().match.update({ where: { id: entry.id }, data: { isEntryList: true } });
    await testDb().tournament.create({
      data: {
        game: "VALORANT",
        weekOf: mondayOfIstWeek(now),
        startsAt: addDays(now, 2),
        title: "Val Cup",
        format: "BRACKET",
        mode: "FIVE_V_FIVE",
        bracketSize: 8,
        entryMatchId: entry.id,
      },
    });
    const week = await getWeekTournaments(now);
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ game: "VALORANT", title: "Val Cup", registrationOpen: true });
  });

  it("previews the top 5 of each game's active season", async () => {
    const season = await testDb().season.create({
      data: {
        game: "FREE_FIRE",
        name: "S1",
        startsAt: addDays(new Date(), -10),
        endsAt: addDays(new Date(), 80),
        isActive: true,
      },
    });
    for (let i = 1; i <= 7; i++) {
      const u = await createUser({ displayName: `P${i}` });
      await testDb().leaderboardSnapshot.create({
        data: {
          seasonId: season.id,
          userId: u.id,
          rank: i,
          points: 100 - i,
          matches: 3,
          wins: 0,
          kills: i,
          roundDiff: 0,
          lastScoredAt: new Date(),
        },
      });
    }
    const boards = await getLeaderboardPreview();
    expect(boards.FREE_FIRE.map((r) => r.name)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(boards.FREE_FIRE).toHaveLength(PREVIEW_ROWS);
    expect(boards.BGMI).toEqual([]);
    expect(boards.VALORANT).toEqual([]);
  });
});

describe("home page settings (Admin → Content → Home page)", () => {
  const valid = {
    statPlayers: "12K+",
    statTournaments: "300+",
    statPrize: "₹2L+",
    liveStats: true,
    trailerUrl: "https://youtube.com/watch?v=abc",
    taglineFreeFire: "Squad up · Win",
    taglineBgmi: "Tactics · Chicken dinner",
    taglineValorant: "Teamwork · Aim",
  };

  it("returns the design's demo values until an admin saves", async () => {
    const { getHomeSettings } = await import("@/server/services/content");
    const { HOME_DEFAULTS } = await import("@/lib/content-keys");
    expect(await getHomeSettings()).toEqual(HOME_DEFAULTS);
  });

  it("lets only admins save, validates every field, and audits the change", async () => {
    const { getHomeSettings, saveHomeSettings } = await import("@/server/services/content");
    const admin = await createUser({ role: "ADMIN" });
    const mod = await createUser({ role: "MODERATOR" });
    const player = await createUser();
    await expect(saveHomeSettings(null, valid)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(saveHomeSettings({ id: player.id, role: "PLAYER" }, valid)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(saveHomeSettings({ id: mod.id, role: "MODERATOR" }, valid)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const actor = { id: admin.id, role: "ADMIN" as const };
    for (const bad of [
      { ...valid, statPlayers: "x".repeat(13) },
      { ...valid, statPrize: "<b>10L</b>" },
      { ...valid, trailerUrl: "http://youtube.com/x" },
      { ...valid, trailerUrl: "javascript:alert(1)" },
      { ...valid, taglineBgmi: "ab" },
      { ...valid, liveStats: "yes" },
    ]) {
      await expect(saveHomeSettings(actor, bad)).rejects.toMatchObject({ code: "VALIDATION" });
    }

    await saveHomeSettings(actor, valid);
    expect(await getHomeSettings()).toEqual({ ...valid });
    await saveHomeSettings(actor, { ...valid, statPlayers: "", trailerUrl: "", liveStats: false });
    expect(await getHomeSettings()).toMatchObject({
      statPlayers: "",
      trailerUrl: null,
      liveStats: false,
    });
    expect(await testDb().auditLog.count({ where: { action: "content.homeSettings" } })).toBe(2);
  });
});

describe("last week's winners", () => {
  it("returns the latest published podium per game, public fields only, and nothing before any is published", async () => {
    const { getLatestWinners } = await import("@/server/queries/home");
    expect(await getLatestWinners()).toEqual([]);
    const podium = (name: string) => [
      {
        place: 2,
        name: `${name} 2`,
        avatarUrl: null,
        prizePaise: 2_000_00,
        userIds: ["u2"],
        payeeUserId: "u2",
      },
      {
        place: 1,
        name: `${name} 1`,
        avatarUrl: null,
        prizePaise: 5_000_00,
        userIds: ["u1"],
        payeeUserId: "u1",
      },
    ];
    const mk = (game: "BGMI" | "VALORANT", weeksAgo: number, title: string, published = true) =>
      testDb().tournament.create({
        data: {
          game,
          title,
          format: game === "VALORANT" ? "BRACKET" : "LOBBY_POINTS",
          mode: game === "VALORANT" ? "FIVE_V_FIVE" : "SQUAD",
          weekOf: mondayOfIstWeek(addDays(new Date(), -7 * weeksAgo)),
          startsAt: addDays(new Date(), -7 * weeksAgo),
          winners: published ? podium(title) : undefined,
          winnersPublishedAt: published ? new Date() : null,
        },
      });
    await mk("BGMI", 2, "Old BGMI Cup");
    await mk("BGMI", 1, "BGMI Cup");
    await mk("VALORANT", 1, "Val Cup");
    await mk("VALORANT", 0, "Val Unpublished", false);

    const slides = await getLatestWinners();
    expect(slides.map((s) => s.title).sort()).toEqual(["BGMI Cup", "Val Cup"]);
    const bgmi = slides.find((s) => s.game === "BGMI")!;
    expect(bgmi.podium.map((p) => p.name)).toEqual(["BGMI Cup 1", "BGMI Cup 2"]);
    expect(JSON.stringify(slides)).not.toMatch(/userIds|payeeUserId|u1|u2/);
  });
});
