import { beforeEach, describe, expect, it, vi } from "vitest";
import { signSession, SESSION_COOKIE } from "@/lib/session-token";
import { createUser, resetDb, testDb } from "../helpers/db";

// Simulated request cookies for next/headers.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    delete: (name: string) => jar.delete(name),
  }),
}));
// React's cache() dedupes per request; in tests we want a fresh read each call.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T>(fn: T) => fn }));

const { requireAdmin, requireModerator, requireUser } = await import("@/server/auth/guards");
const { getCurrentUser } = await import("@/server/auth/session");

async function loginAs(userId: string) {
  jar.set(SESSION_COOKIE, await signSession(userId, process.env.SESSION_SECRET!));
}

beforeEach(async () => {
  jar.clear();
  await resetDb();
});

describe("session guards", () => {
  it("rejects anonymous requests", async () => {
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(requireModerator()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(requireAdmin()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a forged cookie", async () => {
    const u = await createUser({ role: "ADMIN" });
    jar.set(SESSION_COOKIE, await signSession(u.id, "x".repeat(40)));
    await expect(requireAdmin()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("applies roles from the database", async () => {
    const player = await createUser();
    await loginAs(player.id);
    await expect(requireUser()).resolves.toEqual({ id: player.id, role: "PLAYER" });
    await expect(requireModerator()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await testDb().user.update({ where: { id: player.id }, data: { role: "MODERATOR" } });
    await expect(requireModerator()).resolves.toMatchObject({ role: "MODERATOR" });
    await expect(requireAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await testDb().user.update({ where: { id: player.id }, data: { role: "ADMIN" } });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("drops the session as soon as a user is banned", async () => {
    const u = await createUser();
    await loginAs(u.id);
    expect(await getCurrentUser()).not.toBeNull();
    await testDb().user.update({ where: { id: u.id }, data: { bannedAt: new Date() } });
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("drops the session for a merged account", async () => {
    const u = await createUser();
    await loginAs(u.id);
    await testDb().user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    expect(await getCurrentUser()).toBeNull();
  });
});
