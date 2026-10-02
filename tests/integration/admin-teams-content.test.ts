import { beforeEach, describe, expect, it } from "vitest";
import { adminRemoveTeamMember, adminTransferCaptain, getTeamDetail, listTeams } from "@/server/services/admin-teams";
import { listAuditLogs } from "@/server/services/audit-log";
import {
  deleteCarouselItem,
  deleteSponsor,
  getContent,
  getSocialLinks,
  saveCarouselItem,
  saveContent,
  saveSocialLinks,
  saveSponsor,
} from "@/server/services/content";
import type { Actor } from "@/lib/roles";
import { createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
const player: Actor = { id: "p", role: "PLAYER" };

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

async function team() {
  const captain = await createUser();
  const a = await createUser();
  const b = await createUser();
  const t = await testDb().team.create({
    data: {
      game: "BGMI",
      name: `Team ${captain.id.slice(-4)}`,
      captainId: captain.id,
      members: {
        create: [
          { userId: captain.id, game: "BGMI", status: "CONFIRMED" },
          { userId: a.id, game: "BGMI", status: "CONFIRMED" },
          { userId: b.id, game: "BGMI", status: "INVITED" },
        ],
      },
    },
  });
  return { t, captain, a, b };
}

describe("admin teams (moderators and admins)", () => {
  it("refuses players and anonymous users", async () => {
    for (const call of [
      (x: Actor | null) => listTeams(x, {}),
      (x: Actor | null) => getTeamDetail(x, "t"),
      (x: Actor | null) => adminRemoveTeamMember(x, { teamId: "t", userId: "u" }),
      (x: Actor | null) => adminTransferCaptain(x, { teamId: "t", userId: "u" }),
    ]) {
      await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(call(player)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("lists rosters and removes a member (not the captain)", async () => {
    const { t, captain, b } = await team();
    expect((await listTeams(mod, { game: "BGMI" }))[0]?._count.members).toBe(2);
    await expect(adminRemoveTeamMember(mod, { teamId: t.id, userId: captain.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await adminRemoveTeamMember(mod, { teamId: t.id, userId: b.id });
    expect((await getTeamDetail(mod, t.id)).members).toHaveLength(2);
    await expect(adminRemoveTeamMember(mod, { teamId: t.id, userId: b.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("transfers captaincy to a confirmed member only", async () => {
    const { t, a, b } = await team();
    await expect(adminTransferCaptain(mod, { teamId: t.id, userId: b.id })).rejects.toMatchObject({ code: "VALIDATION" });
    await adminTransferCaptain(mod, { teamId: t.id, userId: a.id });
    expect((await testDb().team.findUniqueOrThrow({ where: { id: t.id } })).captainId).toBe(a.id);
    const actions = (await testDb().auditLog.findMany({ where: { entityId: t.id } })).map((x) => x.action);
    expect(actions).toEqual(["team.transferCaptain"]);
  });
});

describe("content (admins only)", () => {
  it("refuses moderators", async () => {
    await expect(saveContent(mod, { key: "faq", body: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveSocialLinks(mod, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveSponsor(mod, { name: "A", logoUrl: "https://a.com/l.png" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteSponsor(mod, { id: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveCarouselItem(mod, { title: "Hi" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteCarouselItem(mod, { id: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAuditLogs(mod, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("saves markdown pages and validates keys", async () => {
    await saveContent(admin, { key: "rules.BGMI", body: "# BGMI rules" });
    expect(await getContent("rules.BGMI")).toBe("# BGMI rules");
    await expect(saveContent(admin, { key: "evil", body: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("accepts only an https link (or nothing) for the scrims video", async () => {
    await expect(saveContent(admin, { key: "scrims.video", body: "javascript:alert(1)" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveContent(admin, { key: "scrims.video", body: "http://youtube.com/watch?v=1" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveContent(mod, { key: "scrims.video", body: "https://youtube.com/watch?v=1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveContent(admin, { key: "scrims.video", body: " https://youtube.com/watch?v=1 " });
    expect((await getContent("scrims.video")).trim()).toBe("https://youtube.com/watch?v=1");
    await saveContent(admin, { key: "scrims.video", body: "" });
    expect(await getContent("scrims.video")).toBe("");
  });

  it("saves social links and clears empty ones", async () => {
    await saveSocialLinks(admin, { DISCORD: "https://discord.gg/abc", YOUTUBE: "https://youtube.com/@x" });
    await saveSocialLinks(admin, { DISCORD: "https://discord.gg/abc", YOUTUBE: "" });
    const links = await getSocialLinks();
    expect(links.find((l) => l.platform === "DISCORD")?.url).toBe("https://discord.gg/abc");
    expect(links.find((l) => l.platform === "YOUTUBE")?.url).toBeNull();
    await expect(saveSocialLinks(admin, { DISCORD: "javascript:alert(1)" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("manages sponsors and carousel items with audit rows", async () => {
    const s = await saveSponsor(admin, { name: "Acme", logoUrl: "https://acme.test/logo.png", order: 1, active: true });
    await saveSponsor(admin, { id: s.id, name: "Acme Corp", logoUrl: "https://acme.test/logo.png", order: 1, active: false });
    await deleteSponsor(admin, { id: s.id });
    const c = await saveCarouselItem(admin, { title: "BGMI winners", game: "BGMI", linkUrl: "/tournament/bgmi", order: 0, active: true });
    await deleteCarouselItem(admin, { id: c.id });
    const { rows } = await listAuditLogs(admin, { entityType: "Sponsor" });
    expect(rows.map((r) => r.action).sort()).toEqual(["sponsor.create", "sponsor.delete", "sponsor.update"]);
    expect((await listAuditLogs(admin, { action: "carousel." })).total).toBe(2);
  });
});

describe("audit log filters", () => {
  it("filters by actor, entity, action and date", async () => {
    await saveContent(admin, { key: "faq", body: "Q&A" });
    const all = await listAuditLogs(admin, {});
    expect(all.total).toBe(1);
    expect(all.entityTypes).toEqual(["SiteContent"]);
    expect((await listAuditLogs(admin, { actor: "system" })).total).toBe(0);
    expect((await listAuditLogs(admin, { action: "content." })).total).toBe(1);
    expect((await listAuditLogs(admin, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
  });
});
