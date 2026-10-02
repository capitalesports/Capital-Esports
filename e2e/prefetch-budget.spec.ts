import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

/**
 * No route prefetch fires on first load: every internal link is an IntentLink (prefetch on hover, touch
 * or keyboard focus), enforced by an ESLint rule on "next/link". Desktop viewport = worst case, because
 * the full navbar is visible there.
 */
export const MAX_PREFETCHES_ON_LOAD = 0;

// Each test walks 20+ routes and waits for idle prefetching on each.
test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

async function prefetchesOnLoad(page: Page, path: string): Promise<string[]> {
  const seen: string[] = [];
  const onRequest = (req: import("@playwright/test").Request) => {
    if (req.headers()["next-router-prefetch"] === "1") seen.push(new URL(req.url()).pathname);
  };
  page.on("request", onRequest);
  const res = await page.goto(path, { waitUntil: "load" });
  expect(res?.status(), path).toBeLessThan(400);
  await page.waitForTimeout(2_500); // prefetching starts after hydration, when the browser is idle
  page.off("request", onRequest);
  return seen;
}

async function ids() {
  const db = e2eDb();
  const match = await db.match.findFirstOrThrow({ where: { isEntryList: false }, orderBy: { createdAt: "asc" } });
  const player = await db.user.findFirstOrThrow({ where: { displayName: { not: null }, deletedAt: null } });
  const season = await db.season.findFirstOrThrow({ where: { game: "BGMI" } });
  const team = await db.team.findFirst();
  const tournament = await db.tournament.findFirst();
  return { match: match.id, player: player.id, season: season.id, team: team?.id, tournament: tournament?.id };
}

function report(results: [string, string[]][]) {
  const table = results.map(([p, list]) => `${String(list.length).padStart(3)}  ${p}${list.length ? `  → ${[...new Set(list)].slice(0, 6).join(", ")}` : ""}`);
  console.log(`Prefetch requests on first load (budget ${MAX_PREFETCHES_ON_LOAD}):\n${table.join("\n")}`);
}

test("public routes stay within the first-load prefetch budget", async ({ page }) => {
  const { match, player, season } = await ids();
  const routes = [
    "/",
    "/scrims",
    `/scrims/${match}`,
    "/tournament",
    "/tournament/bgmi",
    "/tournament/bgmi/past",
    "/leaderboard",
    "/leaderboard/free-fire",
    `/leaderboard/bgmi/seasons/${season}`,
    "/games",
    "/games/free-fire",
    `/players/${player}`,
    "/search?q=scrim",
    "/rules",
    "/faq",
    "/terms",
    "/privacy",
    "/refund-policy",
    "/contact",
    "/login",
  ];
  const results: [string, string[]][] = [];
  for (const path of routes) results.push([path, await prefetchesOnLoad(page, path)]);
  report(results);
  for (const [path, list] of results) expect(list.length, `${path}: ${list.join(", ")}`).toBeLessThanOrEqual(MAX_PREFETCHES_ON_LOAD);
});

test("signed-in and admin routes stay within the first-load prefetch budget", async ({ page }) => {
  const { match, player, team, tournament } = await ids();
  await loginViaUi(page, "9999900001", "/dashboard");
  await page.waitForURL((u) => u.pathname !== "/login"); // the seeded admin has no player profile yet
  const routes = [
    "/dashboard",
    "/profile",
    "/teams",
    "/notifications",
    "/admin",
    "/admin/matches",
    "/admin/matches/new",
    `/admin/matches/${match}`,
    `/admin/matches/${match}/edit`,
    "/admin/results",
    `/admin/results/${match}`,
    "/admin/tournaments",
    ...(tournament ? [`/admin/tournaments/${tournament}`] : []),
    "/admin/users",
    `/admin/users/${player}`,
    "/admin/teams",
    ...(team ? [`/admin/teams/${team}`] : []),
    "/admin/seasons",
    "/admin/reports",
    "/admin/payouts",
    "/admin/content",
    "/admin/audit",
  ];
  const results: [string, string[]][] = [];
  for (const path of routes) results.push([path, await prefetchesOnLoad(page, path)]);
  report(results);
  for (const [path, list] of results) expect(list.length, `${path}: ${list.join(", ")}`).toBeLessThanOrEqual(MAX_PREFETCHES_ON_LOAD);
});

test("links still prefetch on intent: hovering a scrim card starts its prefetch", async ({ page }) => {
  await page.goto("/scrims", { waitUntil: "load" });
  await page.waitForTimeout(1_500);
  const card = page.getByRole("article").first();
  const href = await card.getByRole("heading").getByRole("link").getAttribute("href");
  const prefetch = page.waitForRequest((r) => r.headers()["next-router-prefetch"] === "1" && new URL(r.url()).pathname === href, { timeout: 5_000 });
  await card.getByRole("heading").getByRole("link").hover();
  expect(new URL((await prefetch).url()).pathname).toBe(href);
});
