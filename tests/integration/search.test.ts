import { beforeEach, describe, expect, it } from "vitest";
import { searchSite } from "@/server/queries/search";
import { createMatch, createUser, resetDb, testDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("site search", () => {
  it("finds players by name or IGN, teams and matches, without private fields", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const p = await createUser({ phone: "+919876512345", displayName: "Ayush Pro", games: [{ game: "BGMI", gameId: "5123400001", ign: "TGayush" }] });
    await createUser({ displayName: "Someone Else" });
    await createMatch(admin.id, { title: "Ayush Invitational" });

    const byName = await searchSite("ayush");
    expect(byName.players.map((x) => x.id)).toEqual([p.id]);
    expect(byName.matches.map((m) => m.title)).toEqual(["Ayush Invitational"]);
    const json = JSON.stringify(byName);
    expect(json).not.toContain("9876512345");
    expect(json).not.toContain("5123400001");

    expect((await searchSite("tgay")).players).toHaveLength(1);
    expect((await searchSite("zzz-nothing")).players).toEqual([]);
  });

  it("hides merged accounts and tournament sign-up lists", async () => {
    const admin = await createUser({ role: "ADMIN", displayName: "Boss" });
    await createUser({ displayName: "Ghost Player" });
    const ghost = await createUser({ displayName: "Ghost Merged" });
    await testDb().user.update({ where: { id: ghost.id }, data: { deletedAt: new Date() } });
    const entry = await createMatch(admin.id, { title: "Ghost Cup sign-up" });
    await testDb().match.update({ where: { id: entry.id }, data: { isEntryList: true } });
    const r = await searchSite("ghost");
    expect(r.players.map((x) => x.displayName)).toEqual(["Ghost Player"]);
    expect(r.matches).toEqual([]);
  });
});
