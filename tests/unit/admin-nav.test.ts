import { describe, expect, it } from "vitest";
import { canAccessAdminPath, sectionsForRole } from "@/lib/admin-nav";

describe("admin navigation by role", () => {
  it("gives moderators Matches, Results, Teams and Reports only", () => {
    expect(sectionsForRole("MODERATOR").map((s) => s.label)).toEqual([
      "Matches",
      "Results",
      "Teams",
      "Reports",
    ]);
  });

  it("gives admins everything", () => {
    expect(sectionsForRole("ADMIN").length).toBe(12);
    expect(sectionsForRole("ADMIN").map((s) => s.href)).toEqual(
      expect.arrayContaining(["/admin/points", "/admin/announcements"]),
    );
  });

  it("blocks moderators from admin-only paths", () => {
    expect(canAccessAdminPath("MODERATOR", "/admin/users")).toBe(false);
    expect(canAccessAdminPath("MODERATOR", "/admin/users/123")).toBe(false);
    expect(canAccessAdminPath("MODERATOR", "/admin/content")).toBe(false);
    expect(canAccessAdminPath("MODERATOR", "/admin/points")).toBe(false);
    expect(canAccessAdminPath("MODERATOR", "/admin/announcements")).toBe(false);
    expect(canAccessAdminPath("MODERATOR", "/admin/matches/new")).toBe(true);
    expect(canAccessAdminPath("MODERATOR", "/admin")).toBe(true);
    expect(canAccessAdminPath("ADMIN", "/admin/audit")).toBe(true);
  });
});
