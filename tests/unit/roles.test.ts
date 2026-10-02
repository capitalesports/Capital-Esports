import { describe, expect, it } from "vitest";
import { assertAdmin, assertModerator, assertUser, hasRole, isStaff, type Actor } from "@/lib/roles";
import { AppError } from "@/server/errors";

const player: Actor = { id: "p", role: "PLAYER" };
const mod: Actor = { id: "m", role: "MODERATOR" };
const admin: Actor = { id: "a", role: "ADMIN" };

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.code : "OTHER";
  }
}

describe("role helpers", () => {
  it("ranks roles", () => {
    expect(hasRole(admin, "MODERATOR")).toBe(true);
    expect(hasRole(mod, "ADMIN")).toBe(false);
    expect(hasRole(null, "PLAYER")).toBe(false);
    expect(isStaff(player)).toBe(false);
    expect(isStaff(mod)).toBe(true);
  });

  it("assertUser requires a session", () => {
    expect(codeOf(() => assertUser(null))).toBe("UNAUTHENTICATED");
    expect(assertUser(player)).toBe(player);
  });

  it("assertModerator allows moderators and admins only", () => {
    expect(codeOf(() => assertModerator(null))).toBe("UNAUTHENTICATED");
    expect(codeOf(() => assertModerator(player))).toBe("FORBIDDEN");
    expect(assertModerator(mod)).toBe(mod);
    expect(assertModerator(admin)).toBe(admin);
  });

  it("assertAdmin allows admins only", () => {
    expect(codeOf(() => assertAdmin(player))).toBe("FORBIDDEN");
    expect(codeOf(() => assertAdmin(mod))).toBe("FORBIDDEN");
    expect(assertAdmin(admin)).toBe(admin);
  });
});
