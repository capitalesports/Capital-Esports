import { beforeEach, describe, expect, it } from "vitest";
import { saveGameProfile, updateAvatar, updateProfile } from "@/server/services/profile";
import type { Actor } from "@/lib/roles";
import { createUser, resetDb, testDb } from "../helpers/db";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function actor(): Promise<Actor> {
  const u = await createUser({ displayName: null, dateOfBirth: null });
  return { id: u.id, role: u.role };
}

beforeEach(async () => {
  await resetDb();
});

describe("updateProfile", () => {
  it("requires a logged-in user", async () => {
    await expect(updateProfile(null, { displayName: "Ace", dateOfBirth: "2000-01-01" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("validates input server-side", async () => {
    const me = await actor();
    await expect(updateProfile(me, { displayName: "A", dateOfBirth: "2000-01-01" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { displayName: expect.any(Array) },
    });
    await expect(updateProfile(me, { displayName: "Ace", dateOfBirth: "not-a-date" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("saves name and date of birth", async () => {
    const me = await actor();
    await updateProfile(me, { displayName: " Ace ", dateOfBirth: "2004-05-06" });
    const u = await testDb().user.findUniqueOrThrow({ where: { id: me.id } });
    expect(u.displayName).toBe("Ace");
    expect(u.dateOfBirth?.toISOString().slice(0, 10)).toBe("2004-05-06");
  });

  it("locks the date of birth once saved; the name can still change", async () => {
    const me = await actor();
    await updateProfile(me, { displayName: "Ace", dateOfBirth: "2004-05-06" });
    await expect(updateProfile(me, { displayName: "Ace", dateOfBirth: "2003-05-06" })).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { dateOfBirth: expect.any(Array) },
    });
    await updateProfile(me, { displayName: "Ace Two", dateOfBirth: "2004-05-06" });
    const u = await testDb().user.findUniqueOrThrow({ where: { id: me.id } });
    expect(u.displayName).toBe("Ace Two");
    expect(u.dateOfBirth?.toISOString().slice(0, 10)).toBe("2004-05-06");
  });
});

describe("saveGameProfile", () => {
  it("requires a logged-in user", async () => {
    await expect(saveGameProfile(null, { game: "FREE_FIRE", gameId: "12345678" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("validates per-game formats", async () => {
    const me = await actor();
    await expect(saveGameProfile(me, { game: "FREE_FIRE", gameId: "abc" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveGameProfile(me, { game: "VALORANT", gameId: "NoTag", region: "AP" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("creates then updates the caller's profile for a game (one per game)", async () => {
    const me = await actor();
    await saveGameProfile(me, { game: "BGMI", gameId: "5123456789", ign: "Scout" });
    await saveGameProfile(me, { game: "BGMI", gameId: "5123456790", ign: "Scout2" });
    const rows = await testDb().gameProfile.findMany({ where: { userId: me.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gameId: "5123456790", ign: "Scout2" });
    expect(await testDb().auditLog.count({ where: { entityType: "GameProfile" } })).toBe(2);
  });

  it("keeps game IDs unique across users", async () => {
    const a = await actor();
    const b = await actor();
    await saveGameProfile(a, { game: "FREE_FIRE", gameId: "12345678", ign: "PlayerA" });
    await expect(saveGameProfile(b, { game: "FREE_FIRE", gameId: "12345678", ign: "PlayerB" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("already linked"),
    });
    // Same ID in a different game is fine.
    await expect(saveGameProfile(b, { game: "BGMI", gameId: "12345678", ign: "Bee" })).resolves.toBeTruthy();
  });

  it("treats Riot IDs case-insensitively for uniqueness", async () => {
    const a = await actor();
    const b = await actor();
    await saveGameProfile(a, { game: "VALORANT", gameId: "TenZ#NA1", region: "NA" });
    await expect(saveGameProfile(b, { game: "VALORANT", gameId: "tenz#na1", region: "AP" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses a banned game ID", async () => {
    const me = await actor();
    await testDb().ban.create({ data: { game: "FREE_FIRE", gameId: "87654321", reason: "Cheating" } });
    await expect(saveGameProfile(me, { game: "FREE_FIRE", gameId: "87654321", ign: "Cheater" })).rejects.toMatchObject({ code: "BANNED" });
  });
});

describe("updateAvatar", () => {
  it("requires a logged-in user", async () => {
    await expect(updateAvatar(null, PNG)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects non-images by magic bytes", async () => {
    const me = await actor();
    await expect(updateAvatar(me, new TextEncoder().encode("<svg/>"))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects images over 2 MB", async () => {
    const me = await actor();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    await expect(updateAvatar(me, big)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stores the image and saves the URL", async () => {
    const me = await actor();
    const url = await updateAvatar(me, PNG);
    expect(url).toMatch(new RegExp(`^/api/files/avatars/${me.id}/.+\\.png$`));
    const u = await testDb().user.findUniqueOrThrow({ where: { id: me.id } });
    expect(u.avatarUrl).toBe(url);
  });
});
