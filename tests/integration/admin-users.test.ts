import { beforeEach, describe, expect, it } from "vitest";
import {
  banUser,
  getUserDetail,
  mergeUsers,
  resetGameProfile,
  searchUsers,
  setUserDateOfBirth,
  setUserRole,
  unbanUser,
} from "@/server/services/admin-users";
import { loginWithVerifiedPhone } from "@/server/services/auth";
import { saveGameProfile } from "@/server/services/profile";
import type { Actor } from "@/lib/roles";
import { createMatch, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

describe("admin-only user management", () => {
  const calls: [string, (a: Actor | null) => Promise<unknown>][] = [
    ["searchUsers", (a) => searchUsers(a, "")],
    ["getUserDetail", (a) => getUserDetail(a, "x")],
    ["banUser", (a) => banUser(a, { userId: "x", reason: "abc" })],
    ["unbanUser", (a) => unbanUser(a, { userId: "x" })],
    ["resetGameProfile", (a) => resetGameProfile(a, { userId: "x", game: "BGMI" })],
    ["setUserRole", (a) => setUserRole(a, { userId: "x", role: "ADMIN" })],
    ["setUserDateOfBirth", (a) => setUserDateOfBirth(a, { userId: "x", dateOfBirth: "2000-01-01" })],
    ["mergeUsers", (a) => mergeUsers(a, { primaryId: "x", duplicateId: "y" })],
  ];

  it.each(calls)("%s is refused to moderators and anonymous users", async (_n, call) => {
    await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(call(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call({ id: "p", role: "PLAYER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("support corrects a date of birth", () => {
  it("changes a locked date of birth, validates it and writes the audit log", async () => {
    const u = await createUser({ dateOfBirth: new Date("2004-05-06T00:00:00Z") });
    await expect(setUserDateOfBirth(admin, { userId: u.id, dateOfBirth: "06/05/2004" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await setUserDateOfBirth(admin, { userId: u.id, dateOfBirth: "2003-02-01" });
    const after = await testDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("2003-02-01");
    expect(await testDb().auditLog.count({ where: { action: "user.setDateOfBirth", entityId: u.id } })).toBe(1);
  });
});

describe("search", () => {
  it("finds users by phone digits, name and game ID", async () => {
    const u = await createUser({
      phone: "+919812345678",
      displayName: "Clutch King",
      games: [{ game: "VALORANT", gameId: "clutch#ind1", ign: "Clutch#IND1", region: "AP" }],
    });
    expect((await searchUsers(admin, "12345")).map((r) => r.id)).toContain(u.id);
    expect((await searchUsers(admin, "clutch k")).map((r) => r.id)).toEqual([u.id]);
    expect((await searchUsers(admin, "CLUTCH#IND1")).map((r) => r.id)).toEqual([u.id]);
    expect(await searchUsers(admin, "nobody-here")).toEqual([]);
  });
});

describe("ban / unban", () => {
  it("bans the account, its phone, its email and every game ID; unban lifts them", async () => {
    const u = await createUser({
      phone: "+919800000111",
      email: "cheater@example.com",
      games: [
        { game: "FREE_FIRE", gameId: "11112222" },
        { game: "BGMI", gameId: "5550001", ign: "Bad" },
      ],
    });
    await expect(banUser(admin, { userId: u.id, reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(banUser(admin, { userId: admin.id, reason: "self" })).rejects.toMatchObject({ code: "VALIDATION" });

    await banUser(admin, { userId: u.id, reason: "Aimbot" });
    const bans = await testDb().ban.findMany();
    expect(bans.map((b) => b.phone ?? b.email ?? `${b.game}:${b.gameId}`).sort()).toEqual(
      ["+919800000111", "cheater@example.com", "BGMI:5550001", "FREE_FIRE:11112222"].sort(),
    );
    await expect(loginWithVerifiedPhone("+919800000111")).rejects.toMatchObject({ code: "BANNED" });

    // The banned game ID cannot be claimed by a fresh account.
    const other = await createUser();
    await testDb().gameProfile.deleteMany({ where: { userId: u.id, game: "FREE_FIRE" } });
    await expect(saveGameProfile({ id: other.id, role: "PLAYER" }, { game: "FREE_FIRE", gameId: "11112222", ign: "Banned Name" })).rejects.toMatchObject({
      code: "BANNED",
    });

    await unbanUser(admin, { userId: u.id });
    expect(await testDb().ban.count({ where: { liftedAt: null } })).toBe(1); // the FF ban is no longer attached to u's profiles
    await expect(loginWithVerifiedPhone("+919800000111")).resolves.toMatchObject({ id: u.id });
    const actions = (await testDb().auditLog.findMany({ where: { entityId: u.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.ban", "user.unban"]));
  });

  it("unbanning a player without a phone lifts only their own bans (DECISIONS M31)", async () => {
    const other = await createUser({ games: [{ game: "BGMI", gameId: "5550099", ign: "Other" }] });
    await banUser(admin, { userId: other.id, reason: "Smurfing" });
    const google = await createUser({ email: "nophone@gmail.com" });
    await testDb().user.update({ where: { id: google.id }, data: { phone: null } });
    await banUser(admin, { userId: google.id, reason: "Abuse" });
    await unbanUser(admin, { userId: google.id });
    // The other player's game-ID ban (phone null) must stay in force.
    expect(await testDb().ban.count({ where: { liftedAt: null, gameId: "5550099" } })).toBe(1);
    expect(await testDb().ban.count({ where: { liftedAt: null, email: "nophone@gmail.com" } })).toBe(0);
  });

  it("supports timed bans", async () => {
    const u = await createUser();
    await expect(banUser(admin, { userId: u.id, reason: "Toxic", until: "2001-01-01T10:00" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await banUser(admin, { userId: u.id, reason: "Toxic", until: "2099-01-01T10:00" });
    const row = await testDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.bannedUntil?.toISOString()).toBe("2099-01-01T04:30:00.000Z");
  });
});

describe("profiles, roles and merges", () => {
  it("resets a game profile so the ID can be re-entered", async () => {
    const u = await createUser({ games: [{ game: "BGMI", gameId: "5559999", ign: "Typo" }] });
    await resetGameProfile(admin, { userId: u.id, game: "BGMI" });
    expect(await testDb().gameProfile.count({ where: { userId: u.id } })).toBe(0);
    await expect(resetGameProfile(admin, { userId: u.id, game: "BGMI" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resetGameProfile(admin, { userId: u.id, game: "PUBG" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("changes roles but never the admin's own", async () => {
    const u = await createUser();
    await setUserRole(admin, { userId: u.id, role: "MODERATOR" });
    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("MODERATOR");
    await expect(setUserRole(admin, { userId: admin.id, role: "PLAYER" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setUserRole(admin, { userId: u.id, role: "GOD" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("merges a duplicate: moves registrations and points, soft-deletes the duplicate", async () => {
    const primary = await createUser({ games: [{ game: "BGMI", gameId: "7000001", ign: "Main" }] });
    const dup = await createUser({ games: [{ game: "FREE_FIRE", gameId: "7000002" }, { game: "BGMI", gameId: "7000003", ign: "Alt" }] });
    await testDb().user.update({ where: { id: dup.id }, data: { strikes: 1 } });
    const [m1, m2] = [await createMatch(admin.id), await createMatch(admin.id)];
    const season = await testDb().season.create({
      data: { game: "FREE_FIRE", name: "S1", startsAt: new Date(), endsAt: new Date(Date.now() + 1e9), isActive: true },
    });
    await testDb().registration.createMany({
      data: [
        { matchId: m1.id, userId: dup.id, status: "CONFIRMED", position: 1 },
        { matchId: m2.id, userId: dup.id, status: "CONFIRMED", position: 1 },
        { matchId: m2.id, userId: primary.id, status: "CONFIRMED", position: 2 },
      ],
    });
    await testDb().pointsEntry.create({ data: { seasonId: season.id, userId: dup.id, matchId: m1.id, points: 12, reason: "scrim" } });

    await expect(mergeUsers(admin, { primaryId: primary.id, duplicateId: primary.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const moved = await mergeUsers(admin, { primaryId: primary.id, duplicateId: dup.id });
    expect(moved).toMatchObject({ registrations: 1, points: 1, gameProfiles: 1 });

    const p = await testDb().user.findUniqueOrThrow({ where: { id: primary.id }, include: { gameProfiles: true } });
    expect(p.strikes).toBe(1);
    expect(p.gameProfiles.map((g) => g.game).sort()).toEqual(["BGMI", "FREE_FIRE"]);
    expect(await testDb().pointsEntry.count({ where: { userId: primary.id } })).toBe(1);
    const d = await testDb().user.findUniqueOrThrow({ where: { id: dup.id } });
    expect(d.deletedAt).not.toBeNull();
    expect(d.mergedIntoId).toBe(primary.id);
    await expect(mergeUsers(admin, { primaryId: primary.id, duplicateId: dup.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await testDb().auditLog.count({ where: { action: "user.merge" } })).toBe(1);
  });

  it("shows detail with audit trail", async () => {
    const u = await createUser();
    await banUser(admin, { userId: u.id, reason: "Test ban" });
    const detail = await getUserDetail(admin, u.id);
    expect(detail.audit.map((a) => a.action)).toContain("user.ban");
    await expect(getUserDetail(admin, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
