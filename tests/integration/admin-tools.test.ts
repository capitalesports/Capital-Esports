import { beforeEach, describe, expect, it } from "vitest";
import { pointsConfigFor } from "@/server/services/leaderboard";
import { sendAnnouncement, listAnnouncements } from "@/server/services/announcements";
import { exportAuditCsv } from "@/server/services/audit-export";
import { listPointsConfigs, savePointsConfig } from "@/server/services/points-config";
import type { Actor } from "@/lib/roles";
import { createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
const player: Actor = { id: "p", role: "PLAYER" };

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN", displayName: "Boss" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

const pointsInput = {
  game: "BGMI",
  placementPoints: "20, 14, 10",
  killPoints: "2",
  winPoints: "3",
  lossPoints: "1",
  tournamentMultiplier: "3",
};

const announcement = {
  title: "Diwali Cup",
  body: "Registrations open Friday at 6 PM.",
  link: "/tournaments",
  audience: "ALL",
};

describe("admin tools are admin-only", () => {
  const calls: [string, (a: Actor | null) => Promise<unknown>][] = [
    ["listPointsConfigs", (a) => listPointsConfigs(a)],
    ["savePointsConfig", (a) => savePointsConfig(a, pointsInput)],
    ["sendAnnouncement", (a) => sendAnnouncement(a, announcement)],
    ["listAnnouncements", (a) => listAnnouncements(a)],
    ["exportAuditCsv", (a) => exportAuditCsv(a, {})],
  ];
  it.each(calls)("%s refuses moderators, players and anonymous users", async (_n, call) => {
    await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(call(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call(player)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("points config", () => {
  it("validates every field", async () => {
    for (const bad of [
      { placementPoints: "20, x, 10" },
      { placementPoints: "20, -1" },
      { killPoints: "1.5" },
      { winPoints: "-2" },
      { tournamentMultiplier: "0" },
      { tournamentMultiplier: "11" },
      { game: "CHESS" },
    ]) {
      await expect(savePointsConfig(admin, { ...pointsInput, ...bad })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("saves, is read by the leaderboard and is audited", async () => {
    expect((await pointsConfigFor(testDb(), "BGMI")).placementPoints[0]).toBe(15);
    await savePointsConfig(admin, pointsInput);
    expect(await pointsConfigFor(testDb(), "BGMI")).toEqual({
      placementPoints: [20, 14, 10],
      killPoints: 2,
      winPoints: 3,
      lossPoints: 1,
      tournamentMultiplier: 3,
    });
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "points.config" } });
    expect(audit).toMatchObject({ entityId: "BGMI", actorId: admin.id });
    const all = await listPointsConfigs(admin);
    expect(all.map((c) => c.game)).toEqual(["FREE_FIRE", "BGMI", "VALORANT"]);
  });
});

describe("announcements", () => {
  it("validates title, body, link and audience", async () => {
    for (const bad of [
      { title: "" },
      { body: "" },
      { link: "javascript:alert(1)" },
      { link: "http://example.com" },
      { link: "//evil.example" },
      { audience: "CHESS" },
    ]) {
      await expect(sendAnnouncement(admin, { ...announcement, ...bad })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("sends to the chosen audience (not banned or deleted players) and refuses a quick repeat", async () => {
    const [ff, bgmi, banned] = await Promise.all([
      createPlayer("FREE_FIRE"),
      createPlayer("BGMI"),
      createPlayer("BGMI"),
    ]);
    await testDb().user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
    const out = await sendAnnouncement(admin, { ...announcement, audience: "BGMI" });
    expect(out).toEqual({ recipients: 1 });
    const notes = await testDb().notification.findMany({ where: { type: "ANNOUNCEMENT" } });
    expect(notes.map((n) => [n.userId, n.title, n.url])).toEqual([
      [bgmi.id, "Diwali Cup", "/tournaments"],
    ]);
    expect(notes.some((n) => n.userId === ff.id)).toBe(false);
    await expect(
      sendAnnouncement(admin, { ...announcement, title: "diwali cup", audience: "ALL" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const later = new Date(Date.now() + 6 * 60_000);
    const all = await sendAnnouncement(admin, { ...announcement, link: "" }, later);
    // Everyone not banned: two staff accounts plus two players.
    expect(all.recipients).toBe(4);
    const sent = await listAnnouncements(admin);
    expect(sent.map((s) => [s.audience, s.recipients])).toEqual([
      ["ALL", 4],
      ["BGMI", 1],
    ]);
  });
});

describe("audit CSV export", () => {
  it("exports the filtered entries with escaped JSON", async () => {
    await testDb().auditLog.createMany({
      data: [
        {
          actorId: admin.id,
          action: "match.create",
          entityType: "Match",
          entityId: "m1",
          after: { title: 'Night, "Scrim"' },
        },
        { actorId: null, action: "match.status.auto", entityType: "Match", entityId: "m1" },
        { actorId: admin.id, action: "user.ban", entityType: "User", entityId: "u1" },
      ],
    });
    const { csv, filename } = await exportAuditCsv(admin, { entityType: "Match" });
    expect(filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(csv).toContain('"{""title"":""Night, \\""Scrim\\""""}"');
    expect(csv).not.toContain("user.ban");
    const system = await exportAuditCsv(admin, { actor: "system" });
    expect(system.csv.trim().split("\n")).toHaveLength(2);
    expect(system.csv).toContain('"system"');
  });
});
