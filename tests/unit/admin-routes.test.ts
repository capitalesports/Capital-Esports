import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, canAccessAdminPath } from "@/lib/admin-nav";

const ADMIN_DIR = path.resolve(import.meta.dirname, "../../app/admin");

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return name === "page.tsx" ? [full] : [];
  });
}

function routeOf(file: string): string {
  const rel = path.relative(ADMIN_DIR, path.dirname(file)).split(path.sep).join("/");
  return `/admin${rel ? `/${rel}` : ""}`;
}

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return name === "actions.ts" ? [full] : [];
  });
}

describe("admin route guards", () => {
  const pages = pageFiles(ADMIN_DIR);

  it("finds the admin pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(ADMIN_SECTIONS.length + 1);
  });

  it.each(pages.map((p) => [routeOf(p), p]))("%s calls requireStaffPage", (_route, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await requireStaffPage\(/);
  });

  it.each(pages.map((p) => [routeOf(p)]))("%s: moderators only reach their sections", (route) => {
    const concrete = route.replace(/\[id\]/g, "abc");
    const section = ADMIN_SECTIONS.find((s) => concrete === s.href || concrete.startsWith(`${s.href}/`));
    expect(canAccessAdminPath("ADMIN", concrete)).toBe(true);
    expect(canAccessAdminPath("MODERATOR", concrete)).toBe(section ? section.roles.includes("MODERATOR") : true);
  });

  it("keeps Users, Content, Seasons, Prizes, Tournaments and Audit away from moderators", () => {
    for (const p of ["/admin/users", "/admin/users/1", "/admin/content", "/admin/seasons", "/admin/payouts", "/admin/tournaments", "/admin/audit"]) {
      expect(canAccessAdminPath("MODERATOR", p)).toBe(false);
    }
  });

  it.each(actionFiles(ADMIN_DIR).map((f) => [path.relative(ADMIN_DIR, f), f]))(
    "%s: every exported action calls a role guard",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      const exported = src.split(/export async function /).slice(1);
      expect(exported.length).toBeGreaterThan(0);
      for (const body of exported) expect(body).toMatch(/await require(Moderator|Admin)\(\)/);
    },
  );
});
