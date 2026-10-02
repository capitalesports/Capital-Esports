import { beforeEach, describe, expect, it } from "vitest";
import { getStandingsPage, listPastSeasons, refreshLeaderboard } from "@/server/services/leaderboard";
import { createReport, listReports, REPORT_LIMIT, resolveReport } from "@/server/services/reports";
import { endSeason, exportSeasonCsv, runSeasonRollover, seasonEnd, startSeason } from "@/server/services/seasons";
import type { Actor } from "@/lib/roles";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

async function seasonWithPoints(game: "BGMI" | "VALORANT", endsAt: Date) {
  const season = await testDb().season.create({
    data: { game, name: "Season 1", startsAt: new Date(endsAt.getTime() - 90 * 86400_000), endsAt, isActive: true },
  });
  const m = await createMatch(admin.id, { game, status: "COMPLETED" });
  const players = await Promise.all([1, 2, 3, 4].map(() => createPlayer(game)));
  await testDb().pointsEntry.createMany({
    data: players.map((p, i) => ({ seasonId: season.id, userId: p.id, matchId: m.id, points: 40 - i * 10, reason: "scrim", kills: i })),
  });
  await testDb().$transaction((tx) => refreshLeaderboard(tx, season.id));
  return { season, players };
}

describe("season rollover job", () => {
  it("archives the ended season, records the top 3, starts the next one and keeps history", async () => {
    const end = new Date("2026-09-01T18:30:00Z");
    const { season, players } = await seasonWithPoints("BGMI", end);
    await testDb().user.update({ where: { id: players[0]!.id }, data: { strikes: 2 } });

    expect(await runSeasonRollover(new Date(end.getTime() - 1000))).toEqual([]);
    const rolled = await runSeasonRollover(end);
    expect(rolled).toHaveLength(1);

    const old = await testDb().season.findUniqueOrThrow({ where: { id: season.id } });
    expect(old.isActive).toBe(false);
    const next = await testDb().season.findUniqueOrThrow({ where: { id: rolled[0]!.nextId } });
    expect(next).toMatchObject({ isActive: true, name: "Season 2", game: "BGMI" });
    expect(next.startsAt.toISOString()).toBe(end.toISOString());
    expect(next.endsAt.toISOString()).toBe(seasonEnd(end).toISOString());

    const champions = await testDb().seasonResult.findMany({ where: { seasonId: season.id }, orderBy: { rank: "asc" } });
    expect(champions.map((c) => [c.userId, c.rank, c.points])).toEqual([
      [players[0]!.id, 1, 40],
      [players[1]!.id, 2, 30],
      [players[2]!.id, 3, 20],
    ]);
    // History stays browsable.
    expect((await getStandingsPage(season.id, "BGMI")).total).toBe(4);
    expect((await listPastSeasons("BGMI")).map((s) => s.id)).toEqual([season.id]);
    // Strikes reset for the new season.
    expect((await testDb().user.findUniqueOrThrow({ where: { id: players[0]!.id } })).strikes).toBe(0);
    // Idempotent.
    expect(await runSeasonRollover(end)).toEqual([]);
    expect(await testDb().season.count({ where: { game: "BGMI" } })).toBe(2);
  });
});

describe("admin season controls", () => {
  it("are admin-only and validated", async () => {
    await expect(endSeason(mod, { seasonId: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startSeason(mod, { game: "BGMI", name: "S", startsOn: "2026-10-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportSeasonCsv(mod, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startSeason(admin, { game: "BGMI", name: "Season 9", startsOn: "01/10/2026" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("end then start a season", async () => {
    const { season } = await seasonWithPoints("VALORANT", new Date(Date.now() + 86400_000));
    await expect(startSeason(admin, { game: "VALORANT", name: "Season 2", startsOn: "2026-10-01" })).rejects.toMatchObject({ code: "CONFLICT" });
    await endSeason(admin, { seasonId: season.id });
    await expect(endSeason(admin, { seasonId: season.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await testDb().seasonResult.count({ where: { seasonId: season.id } })).toBe(3);
    const s2 = await startSeason(admin, { game: "VALORANT", name: "Season 2", startsOn: "2026-10-01" });
    expect(s2.startsAt.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect((await testDb().auditLog.findMany({ where: { entityType: "Season" } })).map((a) => a.action).sort()).toEqual(["season.end", "season.start"]);
  });

  it("exports CSV with formula injection neutralised", async () => {
    const { season, players } = await seasonWithPoints("BGMI", new Date(Date.now() + 86400_000));
    await testDb().user.update({ where: { id: players[0]!.id }, data: { displayName: "=HYPERLINK(evil)" } });
    const { filename, csv } = await exportSeasonCsv(admin, season.id);
    expect(filename).toBe("leaderboard-bgmi-season-1.csv");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("rank,player,game_id,points,matches,wins,kills,round_diff");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain(`"'=HYPERLINK(evil)"`);
  });
});

describe("reports and disputes", () => {
  it("validates reports", async () => {
    const a = await createPlayer();
    const b = await createPlayer();
    await expect(createReport(null, { type: "PLAYER", targetUserId: b.id, reason: "Cheating in lobby" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(createReport(player(a), { type: "PLAYER", reason: "Cheating in lobby" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: "short" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createReport(player(a), { type: "PLAYER", targetUserId: a.id, reason: "Reporting myself here" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: "Wallhack all game long", evidenceUrl: "javascript:x" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const r = await createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: "Wallhack all game long", evidenceUrl: "https://youtu.be/x" });
    expect(r.status).toBe("OPEN");
  });

  it("allows disputes only within 2 hours and only from players of the match", async () => {
    const p = await createPlayer();
    const outsider = await createPlayer();
    const m = await createMatch(admin.id, { status: "COMPLETED" });
    await testDb().registration.create({ data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    await testDb().match.update({ where: { id: m.id }, data: { resultsApprovedAt: new Date(Date.now() - 30 * 60_000) } });
    await expect(createReport(player(outsider), { type: "DISPUTE", matchId: m.id, reason: "Placement is wrong for us" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await createReport(player(p), { type: "DISPUTE", matchId: m.id, reason: "Placement is wrong for us" });
    await testDb().match.update({ where: { id: m.id }, data: { resultsApprovedAt: new Date(Date.now() - 3 * 3600_000) } });
    await expect(createReport(player(p), { type: "DISPUTE", matchId: m.id, reason: "Placement is wrong again" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rate-limits report creation", async () => {
    const a = await createPlayer();
    const b = await createPlayer();
    for (let i = 0; i < REPORT_LIMIT.limit; i++) await createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: `Spam report number ${i}` });
    await expect(createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: "One report too many" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("moderators resolve reports with an audit row", async () => {
    const a = await createPlayer();
    const b = await createPlayer();
    const r = await createReport(player(a), { type: "PLAYER", targetUserId: b.id, reason: "Toxic in voice chat" });
    await expect(listReports(player(a))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolveReport(player(a), { reportId: r.id, status: "RESOLVED", resolution: "ok" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolveReport(mod, { reportId: r.id, status: "RESOLVED", resolution: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listReports(mod)).map((x) => x.id)).toEqual([r.id]);
    await resolveReport(mod, { reportId: r.id, status: "DISMISSED", resolution: "No evidence" });
    await expect(resolveReport(mod, { reportId: r.id, status: "RESOLVED", resolution: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listReports(mod)).toEqual([]);
    expect(await testDb().auditLog.count({ where: { action: "report.resolve", entityId: r.id } })).toBe(1);
  });
});
