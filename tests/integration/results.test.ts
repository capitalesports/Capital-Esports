import { beforeEach, describe, expect, it, vi } from "vitest";

// Player result submission is switched off on the site (M48), but the code stays: test it switched on.
vi.mock("@/lib/results-config", () => ({ PLAYERS_SUBMIT_RESULTS: true }));
import { loginWithVerifiedPhone } from "@/server/services/auth";
import { getStandingsPage } from "@/server/services/leaderboard";
import { registerForMatch } from "@/server/services/registration";
import {
  approveResults,
  reopenResults,
  saveResultRows,
  submitResult,
} from "@/server/services/results";
import { defaultPointsConfig } from "@/lib/points";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let admin: Actor;
let mod: Actor;
let seasonId: string;
const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
  for (const game of ["BGMI", "FREE_FIRE", "VALORANT"] as const) {
    const s = await testDb().season.create({
      data: {
        game,
        name: "S1",
        startsAt: new Date(Date.now() - 86400_000),
        endsAt: new Date(Date.now() + 80 * 86400_000),
        isActive: true,
      },
    });
    if (game === "BGMI") seasonId = s.id;
    await testDb().pointsConfig.create({ data: { game, ...defaultPointsConfig(game) } });
  }
});

/** A BGMI solo match in RESULTS_PENDING with `n` confirmed players. */
async function pendingMatch(
  n: number,
  extra: {
    kind?: "SCRIM" | "TOURNAMENT";
    game?: "BGMI" | "VALORANT";
    mode?: "SOLO" | "DUO" | "SQUAD" | "ONE_V_ONE" | "FIVE_V_FIVE";
  } = {},
) {
  const game = extra.game ?? "BGMI";
  const m = await createMatch(admin.id, {
    game,
    mode: extra.mode ?? "SOLO",
    maxSlots: Math.max(n, 2),
    status: "RESULTS_PENDING",
    startsAt: addMinutes(new Date(), -60),
    kind: extra.kind,
  });
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = await createPlayer(game);
    const reg = await testDb().registration.create({
      data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: i + 1 },
    });
    players.push({ ...p, regId: reg.id });
  }
  return { m, players };
}

describe("result submission", () => {
  it("requires login, a confirmed registration and RESULTS_PENDING", async () => {
    const { m, players } = await pendingMatch(1);
    await expect(submitResult(null, { matchId: m.id }, PNG)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const outsider = await createPlayer("BGMI");
    await expect(
      submitResult(player(outsider), { matchId: m.id, placement: 1, kills: 1 }, PNG),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const open = await createMatch(admin.id, { game: "BGMI" });
    await expect(
      submitResult(player(players[0]!), { matchId: open.id, placement: 1, kills: 1 }, PNG),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates placement, kills and the screenshot (magic bytes)", async () => {
    const { m, players } = await pendingMatch(2);
    const me = player(players[0]!);
    await expect(submitResult(me, { matchId: m.id, kills: 1 }, PNG)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      submitResult(me, { matchId: m.id, placement: 0, kills: 1 }, PNG),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      submitResult(me, { matchId: m.id, placement: 1, kills: 1 }, null),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      submitResult(
        me,
        { matchId: m.id, placement: 1, kills: 1 },
        new TextEncoder().encode("<html>"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await submitResult(me, { matchId: m.id, placement: 1, kills: 4 }, PNG);
    expect(r).toMatchObject({ placement: 1, kills: 4, submittedById: me.id });
    expect(r.screenshotUrl).toMatch(/^\/api\/files\/results\//);
    // Resubmitting replaces the numbers and keeps the screenshot.
    const again = await submitResult(me, { matchId: m.id, placement: 2, kills: 3 }, null);
    expect(again).toMatchObject({ placement: 2, kills: 3, screenshotUrl: r.screenshotUrl });
  });

  it("Valorant 1v1: win/loss with a tracker link instead of a screenshot", async () => {
    const { m, players } = await pendingMatch(2, { game: "VALORANT", mode: "ONE_V_ONE" });
    await expect(submitResult(player(players[0]!), { matchId: m.id }, null)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      submitResult(player(players[0]!), { matchId: m.id, won: true, trackerUrl: "http://x" }, null),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await submitResult(
      player(players[0]!),
      { matchId: m.id, won: true, trackerUrl: "https://tracker.gg/valorant/match/1" },
      null,
    );
    expect(r).toMatchObject({ won: true, placement: null });
  });

  it("a captain-entered squad: the captain and teammates with accounts get points, others are skipped", async () => {
    const m = await createMatch(admin.id, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const mate = await createUser({ games: [{ game: "BGMI", gameId: "72000001", ign: "Linked" }] });
    await registerForMatch(player(cap), {
      matchId: m.id,
      teamName: "Mixed Squad",
      players: [
        { gameId: "72000001", ign: "Linked" },
        { gameId: "72000002", ign: "No Account 1" },
        { gameId: "72000003", ign: "No Account 2" },
      ],
    });
    await testDb().match.update({ where: { id: m.id }, data: { status: "RESULTS_PENDING" } });
    await submitResult(player(cap), { matchId: m.id, placement: 1, kills: 6 }, PNG);
    await approveResults(mod, { matchId: m.id });
    const points = await testDb().pointsEntry.findMany({ where: { matchId: m.id } });
    expect(points.map((p) => p.userId).sort()).toEqual([cap.id, mate.id].sort());
    expect(points.every((p) => p.points === points[0]!.points && p.kills === 6)).toBe(true);
  });

  it("BGMI 1v1 (TDM) is win/loss, and approval awards win points instead of placement points", async () => {
    const { m, players } = await pendingMatch(2, { mode: "ONE_V_ONE" });
    await expect(
      submitResult(player(players[0]!), { matchId: m.id, placement: 1, kills: 5 }, PNG),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { won: expect.any(Array) },
    });
    expect(
      await submitResult(player(players[0]!), { matchId: m.id, won: true }, PNG),
    ).toMatchObject({ won: true, placement: null, kills: null });
    await submitResult(player(players[1]!), { matchId: m.id, won: false }, PNG);
    await approveResults(mod, { matchId: m.id });
    const points = await testDb().pointsEntry.findMany({ where: { matchId: m.id } });
    const cfg = defaultPointsConfig("BGMI");
    expect(points.find((p) => p.userId === players[0]!.id)).toMatchObject({
      points: cfg.winPoints,
      won: true,
    });
    expect(points.find((p) => p.userId === players[1]!.id)).toMatchObject({
      points: cfg.lossPoints,
      won: false,
    });
  });
});

describe("moderation, approval and reversal", () => {
  it("only moderators can edit, approve or reopen", async () => {
    const { m, players } = await pendingMatch(1);
    for (const call of [
      (a: Actor | null) => saveResultRows(a, { matchId: m.id, rows: [] }),
      (a: Actor | null) => approveResults(a, { matchId: m.id }),
      (a: Actor | null) => reopenResults(a, { matchId: m.id }),
    ]) {
      await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(call(player(players[0]!))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      saveResultRows(mod, {
        matchId: m.id,
        rows: [{ registrationId: "nope", placement: 1, kills: 0 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("tells only the prize winner they won and that it is paid within 2 working days (DECISIONS M28)", async () => {
    const { m, players } = await pendingMatch(2);
    await testDb().match.update({
      where: { id: m.id },
      data: { prizePaise: 45_400, title: "Prize Rush" },
    });
    const [a, b] = players;
    await submitResult(player(a!), { matchId: m.id, placement: 1, kills: 4 }, PNG);
    await submitResult(player(b!), { matchId: m.id, placement: 2, kills: 2 }, PNG);
    await approveResults(mod, { matchId: m.id });
    const won = await testDb().notification.findMany({ where: { type: "PRIZE_WON" } });
    expect(won.map((n) => n.userId)).toEqual([a!.id]);
    expect(won[0]!.body).toContain("1st in Prize Rush");
    expect(won[0]!.body).toContain("within 2 working days");
  });

  it("approving posts points, marks no-shows with a strike, completes the match and updates the leaderboard immediately", async () => {
    const { m, players } = await pendingMatch(3);
    const [a, b, c] = players;
    await submitResult(player(a!), { matchId: m.id, placement: 1, kills: 5 }, PNG);
    await submitResult(player(b!), { matchId: m.id, placement: 2, kills: 1 }, PNG);
    // c never submits -> no-show
    const summary = await approveResults(mod, { matchId: m.id });
    expect(summary).toEqual({ entries: 2, noShows: 1 });

    const match = await testDb().match.findUniqueOrThrow({ where: { id: m.id } });
    expect(match.status).toBe("COMPLETED");
    expect(match.resultsApprovedAt).not.toBeNull();
    expect(
      (await testDb().registration.findUniqueOrThrow({ where: { id: c!.regId } })).status,
    ).toBe("NO_SHOW");
    expect((await testDb().user.findUniqueOrThrow({ where: { id: c!.id } })).strikes).toBe(1);

    const board = await getStandingsPage(seasonId, "BGMI");
    expect(board.rows.map((r) => [r.userId, r.points, r.rank, r.wins, r.kills])).toEqual([
      [a!.id, 20, 1, 1, 5],
      [b!.id, 13, 2, 0, 1],
    ]);
    const actions = (await testDb().auditLog.findMany({ where: { entityId: m.id } })).map(
      (x) => x.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["results.approve", "results.points"]));
  });

  it("blocks approval while two entries claim the same placement", async () => {
    const { m, players } = await pendingMatch(2);
    await saveResultRows(mod, {
      matchId: m.id,
      rows: players.map((p) => ({ registrationId: p.regId, placement: 1, kills: 0 })),
    });
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("same placement"),
    });
  });

  it("duo partners may share a placement (up to 2 per placement), a third claim conflicts", async () => {
    const { m, players } = await pendingMatch(3, { mode: "DUO" });
    const [a, b, c] = players;
    await submitResult(player(a!), { matchId: m.id, placement: 1, kills: 2 }, PNG);
    await submitResult(player(b!), { matchId: m.id, placement: 1, kills: 1 }, PNG);
    await submitResult(player(c!), { matchId: m.id, placement: 1, kills: 0 }, PNG);
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("same placement"),
    });
    await submitResult(player(c!), { matchId: m.id, placement: 2, kills: 0 }, PNG);
    await expect(approveResults(mod, { matchId: m.id })).resolves.toEqual({
      entries: 3,
      noShows: 0,
    });
  });

  it("solo still allows only one entry per placement", async () => {
    const { m, players } = await pendingMatch(2, { mode: "SOLO" });
    for (const p of players)
      await submitResult(player(p), { matchId: m.id, placement: 3, kills: 0 }, PNG);
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("head-to-head: needs exactly one winner and refuses approval when no side has a result", async () => {
    const { m, players } = await pendingMatch(2, { mode: "ONE_V_ONE" });
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("walkover"),
    });
    await saveResultRows(mod, {
      matchId: m.id,
      rows: players.map((p) => ({ registrationId: p.regId, won: true })),
    });
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Mark exactly one winner.",
    });
    // Walkover: only the side that showed up has a result, and it won.
    await saveResultRows(mod, {
      matchId: m.id,
      rows: [
        { registrationId: players[0]!.regId, won: true },
        { registrationId: players[1]!.regId, absent: true },
      ],
    });
    await expect(approveResults(mod, { matchId: m.id })).resolves.toEqual({
      entries: 1,
      noShows: 1,
    });
  });

  it("head-to-head submission takes an optional round difference (0-13) signed by the result", async () => {
    const { m, players } = await pendingMatch(2, { mode: "ONE_V_ONE" });
    const [a, b] = players;
    await expect(
      submitResult(player(a!), { matchId: m.id, won: true, roundDiff: 14 }, PNG),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { roundDiff: expect.any(Array) } });
    await expect(
      submitResult(player(a!), { matchId: m.id, won: true, roundDiff: -2 }, PNG),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(
      await submitResult(player(a!), { matchId: m.id, won: true, roundDiff: "5" }, PNG),
    ).toMatchObject({ won: true, roundDiff: 5 });
    expect(
      await submitResult(player(b!), { matchId: m.id, won: false, roundDiff: 5 }, PNG),
    ).toMatchObject({ won: false, roundDiff: -5 });
    expect(
      await submitResult(player(b!), { matchId: m.id, won: false, roundDiff: "" }, PNG),
    ).toMatchObject({ roundDiff: null });
  });

  it("refuses approval without an active season", async () => {
    const { m } = await pendingMatch(1);
    await testDb().season.updateMany({ data: { isActive: false } });
    await expect(approveResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("tournament matches score double", async () => {
    const t = await testDb().tournament.create({
      data: {
        game: "BGMI",
        weekOf: new Date("2026-09-28"),
        startsAt: new Date("2026-10-01T14:30:00Z"),
        title: "Cup",
        format: "LOBBY_POINTS",
        mode: "SQUAD",
      },
    });
    const { m, players } = await pendingMatch(1, { kind: "TOURNAMENT" });
    await testDb().match.update({ where: { id: m.id }, data: { tournamentId: t.id } });
    await saveResultRows(mod, {
      matchId: m.id,
      rows: [{ registrationId: players[0]!.regId, placement: 1, kills: 2 }],
    });
    await approveResults(mod, { matchId: m.id });
    expect((await testDb().pointsEntry.findFirstOrThrow({ where: { matchId: m.id } })).points).toBe(
      34,
    );
  });

  it("squad points go to every confirmed member", async () => {
    const m = await createMatch(admin.id, {
      game: "BGMI",
      mode: "SQUAD",
      maxSlots: 4,
      status: "RESULTS_PENDING",
    });
    const squad = await Promise.all([1, 2, 3, 4].map(() => createPlayer("BGMI")));
    const team = await testDb().team.create({
      data: { game: "BGMI", name: "Sq", captainId: squad[0]!.id },
    });
    const reg = await testDb().registration.create({
      data: {
        matchId: m.id,
        userId: squad[0]!.id,
        teamId: team.id,
        status: "CONFIRMED",
        position: 1,
      },
    });
    await testDb().registrationMember.createMany({
      data: squad.map((p) => ({
        registrationId: reg.id,
        matchId: m.id,
        userId: p.id,
        status: "CONFIRMED" as const,
      })),
    });
    await saveResultRows(mod, {
      matchId: m.id,
      rows: [{ registrationId: reg.id, placement: 2, kills: 7 }],
    });
    await approveResults(mod, { matchId: m.id });
    const entries = await testDb().pointsEntry.findMany({ where: { matchId: m.id } });
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.points === 19)).toBe(true);
  });

  it("reopening reverses points and no-show strikes; approving again reposts", async () => {
    const { m, players } = await pendingMatch(2);
    await submitResult(player(players[0]!), { matchId: m.id, placement: 1, kills: 0 }, PNG);
    await approveResults(mod, { matchId: m.id });
    expect(await testDb().pointsEntry.count({ where: { matchId: m.id } })).toBe(1);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: players[1]!.id } })).strikes).toBe(
      1,
    );

    await reopenResults(mod, { matchId: m.id });
    expect((await testDb().match.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      "RESULTS_PENDING",
    );
    expect(await testDb().pointsEntry.count({ where: { matchId: m.id } })).toBe(0);
    expect((await getStandingsPage(seasonId, "BGMI")).total).toBe(0);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: players[1]!.id } })).strikes).toBe(
      0,
    );
    expect(
      (await testDb().registration.findUniqueOrThrow({ where: { id: players[1]!.regId } })).status,
    ).toBe("CONFIRMED");

    await saveResultRows(mod, {
      matchId: m.id,
      rows: [{ registrationId: players[1]!.regId, placement: 2, kills: 3 }],
    });
    await approveResults(mod, { matchId: m.id });
    expect((await getStandingsPage(seasonId, "BGMI")).total).toBe(2);
  });

  it("moderators can reopen only within 2 hours; admins any time", async () => {
    const { m, players } = await pendingMatch(1);
    await submitResult(player(players[0]!), { matchId: m.id, placement: 1, kills: 0 }, PNG);
    await approveResults(mod, { matchId: m.id }, new Date(Date.now() - 3 * 3600_000));
    await expect(reopenResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await reopenResults(admin, { matchId: m.id });
    await expect(reopenResults(admin, { matchId: m.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("reopen validates the reason and writes it to the audit log", async () => {
    const { m, players } = await pendingMatch(1);
    await submitResult(player(players[0]!), { matchId: m.id, placement: 1, kills: 0 }, PNG);
    await approveResults(mod, { matchId: m.id });
    await expect(
      reopenResults(mod, { matchId: m.id, reason: "x".repeat(301) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await reopenResults(mod, { matchId: m.id, reason: "Dispute: wrong placement" });
    const log = await testDb().auditLog.findFirstOrThrow({
      where: { entityId: m.id, action: "results.reopen.detail" },
    });
    expect(log.after).toMatchObject({ reason: "Dispute: wrong placement" });
  });

  it("published tournament winners: moderators cannot reopen, admins can and the winners are cleared", async () => {
    const t = await testDb().tournament.create({
      data: {
        game: "BGMI",
        weekOf: new Date("2026-09-28"),
        startsAt: new Date("2026-10-01T14:30:00Z"),
        title: "Cup",
        format: "LOBBY_POINTS",
        mode: "SOLO",
      },
    });
    const { m, players } = await pendingMatch(1, { kind: "TOURNAMENT" });
    await testDb().match.update({ where: { id: m.id }, data: { tournamentId: t.id } });
    await submitResult(player(players[0]!), { matchId: m.id, placement: 1, kills: 0 }, PNG);
    await approveResults(mod, { matchId: m.id });
    await testDb().tournament.update({
      where: { id: t.id },
      data: { winners: [{ place: 1, name: "X" }], winnersPublishedAt: new Date() },
    });
    await testDb().carouselItem.create({ data: { title: "X won", tournamentId: t.id } });
    await expect(reopenResults(mod, { matchId: m.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("winners are already published"),
    });
    await reopenResults(admin, { matchId: m.id, reason: "Wrong podium" });
    const after = await testDb().tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.winnersPublishedAt).toBeNull();
    expect(after.winners).toBeNull();
    expect(
      (await testDb().carouselItem.findFirstOrThrow({ where: { tournamentId: t.id } })).active,
    ).toBe(false);
  });
});

describe("strike accumulation", () => {
  it("3 no-shows in a season block registration for 7 days but the player can still log in", async () => {
    const victim = await createPlayer("BGMI");
    for (let i = 0; i < 3; i++) {
      const m = await createMatch(admin.id, {
        game: "BGMI",
        status: "RESULTS_PENDING",
        maxSlots: 2,
      });
      await testDb().registration.create({
        data: { matchId: m.id, userId: victim.id, status: "CONFIRMED", position: 1 },
      });
      await approveResults(mod, { matchId: m.id });
    }
    const u = await testDb().user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(u.strikes).toBe(3);
    const days = (u.registrationBlockedUntil!.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const open = await createMatch(admin.id, { game: "BGMI" });
    await expect(registerForMatch(player(victim), { matchId: open.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(loginWithVerifiedPhone(u.phone!)).resolves.toMatchObject({ id: victim.id });
  });
});
