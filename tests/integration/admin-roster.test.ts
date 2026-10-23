import { beforeEach, describe, expect, it } from "vitest";
import { adminEditRosterPlayer } from "@/server/services/admin-roster";
import type { Actor } from "@/lib/roles";
import { createMatch, createPlayer, createUser, nextGameId, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
const player: Actor = { id: "p", role: "PLAYER" };

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

/** A confirmed squad entry with a captain-entered roster: [captain, then 3 by game ID]. */
async function squadEntry(matchId: string, captainId: string, ids: string[]) {
  const reg = await testDb().registration.create({
    data: { matchId, userId: captainId, teamName: "Rush", status: "CONFIRMED", position: 1 },
  });
  await testDb().registrationMember.createMany({
    data: ids.map((gameId, i) => ({
      registrationId: reg.id,
      matchId,
      userId: i === 0 ? captainId : null,
      gameId,
      ign: `P${i}`,
      status: "CONFIRMED" as const,
    })),
  });
  const members = await testDb().registrationMember.findMany({
    where: { registrationId: reg.id },
    orderBy: { gameId: "asc" },
  });
  return { reg, byId: (id: string) => members.find((m) => m.gameId === id)! };
}

describe("roster edit: roles and validation", () => {
  it("is moderator-only, admin-only for tournament matches", async () => {
    for (const a of [null, player]) {
      await expect(
        adminEditRosterPlayer(a, { memberId: "x", gameId: "1234567890", ign: "A" }),
      ).rejects.toMatchObject({ code: a ? "FORBIDDEN" : "UNAUTHENTICATED" });
    }
    const cap = await createPlayer();
    const m = await createMatch(admin.id, { mode: "SQUAD", capped: true });
    const { byId } = await squadEntry(m.id, cap.id, ["111111", "222222", "333333", "444444"]);
    await expect(
      adminEditRosterPlayer(mod, { memberId: byId("222222").id, gameId: "5555555", ign: "New" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates input", async () => {
    await expect(adminEditRosterPlayer(mod, { gameId: "123456" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      adminEditRosterPlayer(mod, { memberId: "missing", gameId: "1234567", ign: "A" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const cap = await createPlayer();
    const m = await createMatch(admin.id, { mode: "SQUAD" });
    const { byId } = await squadEntry(m.id, cap.id, ["111111", "222222", "333333", "444444"]);
    const memberId = byId("222222").id;
    await expect(
      adminEditRosterPlayer(mod, { memberId, gameId: "abc", ign: "New" }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { gameId: expect.any(Array) } });
    await expect(
      adminEditRosterPlayer(mod, { memberId, gameId: "1234567", ign: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("roster edit", () => {
  it("replaces a player, links a matching account and writes an audit entry", async () => {
    const cap = await createPlayer();
    const gaurav = await createPlayer();
    const gauravId = (await testDb().gameProfile.findFirstOrThrow({ where: { userId: gaurav.id } }))
      .gameId;
    const m = await createMatch(admin.id, { mode: "SQUAD", status: "REGISTRATION_CLOSED" });
    const { reg, byId } = await squadEntry(m.id, cap.id, ["111111", "222222", "333333", "444444"]);
    const memberId = byId("111111").id;

    await adminEditRosterPlayer(mod, { memberId, gameId: gauravId, ign: "exact ign" });
    expect(
      await testDb().registrationMember.findUniqueOrThrow({ where: { id: memberId } }),
    ).toMatchObject({ gameId: gauravId, ign: "exact ign", userId: gaurav.id });
    expect(
      await testDb().auditLog.findFirst({
        where: { action: "registration.roster_edit", entityId: reg.id },
      }),
    ).toMatchObject({ actorId: mod.id });

    // A name that doesn't match the account's: kept by ID only, not linked.
    await adminEditRosterPlayer(mod, { memberId, gameId: gauravId, ign: "Someone" });
    expect(
      await testDb().registrationMember.findUniqueOrThrow({ where: { id: memberId } }),
    ).toMatchObject({ ign: "Someone", userId: null });
  });

  it("rejects an ID already in the match, a banned ID and a started match", async () => {
    const cap = await createPlayer();
    const m = await createMatch(admin.id, { mode: "SQUAD" });
    const { byId } = await squadEntry(m.id, cap.id, ["111111", "222222", "333333", "444444"]);
    const memberId = byId("222222").id;
    await expect(
      adminEditRosterPlayer(mod, { memberId, gameId: "333333", ign: "Dup" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Unchanged ID (fixing only the name) is fine.
    await adminEditRosterPlayer(mod, { memberId, gameId: "222222", ign: "Fixed" });

    const banned = nextGameId();
    await testDb().ban.create({
      data: { game: "FREE_FIRE", gameId: banned, reason: "Cheating", createdById: admin.id },
    });
    await expect(
      adminEditRosterPlayer(mod, { memberId, gameId: banned, ign: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await testDb().match.update({ where: { id: m.id }, data: { status: "LIVE" } });
    await expect(
      adminEditRosterPlayer(mod, { memberId, gameId: "5555555", ign: "Late" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("in a tournament match, also fixes the sign-up list later rounds copy from", async () => {
    const cap = await createPlayer();
    const entry = await createMatch(admin.id, { mode: "SQUAD", capped: true });
    const t = await testDb().tournament.update({
      where: { id: entry.tournamentId! },
      data: { entryMatchId: entry.id },
    });
    await testDb().match.update({ where: { id: entry.id }, data: { isEntryList: true } });
    const game = await createMatch(admin.id, {
      mode: "SQUAD",
      tournamentId: t.id,
      status: "REGISTRATION_CLOSED",
    });
    const ids = ["111111", "222222", "333333", "444444"];
    const source = await squadEntry(entry.id, cap.id, ids);
    const copy = await squadEntry(game.id, cap.id, ids);

    await adminEditRosterPlayer(admin, {
      memberId: copy.byId("222222").id,
      gameId: "10161322345",
      ign: "Gaurav bhai",
    });
    for (const id of [copy.byId("222222").id, source.byId("222222").id]) {
      expect(
        await testDb().registrationMember.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ gameId: "10161322345", ign: "Gaurav bhai" });
    }
  });
});
