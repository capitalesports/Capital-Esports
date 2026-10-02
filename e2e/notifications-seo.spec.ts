import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

test.describe.configure({ mode: "serial" });

test("in-app inbox: unread badge, list, mark all read", async ({ page }) => {
  const db = e2eDb();
  const user = await db.user.create({
    data: {
      phone: "+919811100301",
      displayName: "Inbox Tester",
      dateOfBirth: new Date("2000-01-01"),
      gameProfiles: { create: { game: "FREE_FIRE", gameId: "30130130" } },
      notifications: {
        create: [
          { type: "MATCH_STARTING_SOON", title: "Starting in 30 minutes", body: "Evening Scrim starts in 30 minutes.", url: "/scrims" },
          { type: "REGISTRATION_CONFIRMED", title: "Slot confirmed", body: "You're in for Evening Scrim.", url: "/scrims" },
        ],
      },
    },
  });
  await loginViaUi(page, "9811100301", "/dashboard");
  await page.waitForURL(/\/dashboard/);
  const bell = page.getByRole("link", { name: "Notifications, 2 unread" });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page).toHaveURL(/\/notifications$/);
  const list = page.getByRole("list", { name: "Notifications" });
  await expect(list.getByText("Starting in 30 minutes")).toBeVisible();
  await expect(list.getByText("Slot confirmed")).toBeVisible();
  await expect(list.getByLabel("Unread")).toHaveCount(2);
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  expect(await db.notification.count({ where: { userId: user.id, readAt: null } })).toBe(0);
});

test("OG images render for a match, a tournament and a rank card", async ({ page, request }) => {
  const db = e2eDb();
  const match = await db.match.findFirstOrThrow({ where: { isEntryList: false, status: { not: "CANCELLED" } } });
  const player = await db.user.findFirstOrThrow({ where: { gameProfiles: { some: { game: "FREE_FIRE" } } } });
  const ogOf = async (path: string) => {
    await page.goto(path);
    const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(content, path).toBeTruthy();
    return new URL(content!).pathname + new URL(content!).search;
  };
  const urls = [
    await ogOf(`/scrims/${match.id}`),
    await ogOf("/tournament/bgmi"),
    await ogOf(`/players/${player.id}?game=free-fire`),
    `/leaderboard/free-fire/card/${player.id}`,
    "/icons/192",
    "/icons/512",
  ];
  expect(urls[2]).toBe(`/leaderboard/free-fire/card/${player.id}`);
  for (const url of urls) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["content-type"], url).toContain("image/png");
    const body = await res.body();
    expect(body.subarray(0, 8).toString("hex"), url).toBe("89504e470d0a1a0a");
    expect(body.length, url).toBeGreaterThan(2000);
  }
  expect((await request.get("/leaderboard/free-fire/card/nobody")).status()).toBe(404);

  // Browser and iOS icons come from the same renderer as the PWA icons (app-icon artwork or the gold monogram).
  await page.goto("/");
  for (const rel of ["icon", "apple-touch-icon"]) {
    const href = await page.locator(`link[rel="${rel}"]`).first().getAttribute("href");
    expect(href, rel).toMatch(/^\/(icon|apple-icon)/);
    const res = await request.get(href!);
    expect(res.headers()["content-type"], rel).toContain("image/png");
  }
});

test("empty inbox shows the empty-no-notifications artwork slot", async ({ page }) => {
  await e2eDb().user.create({
    data: { phone: "+919811100302", displayName: "Quiet Inbox", dateOfBirth: new Date("2000-01-01"), gameProfiles: { create: { game: "BGMI", gameId: "5130130130" } } },
  });
  await loginViaUi(page, "9811100302", "/notifications");
  await page.waitForURL(/\/notifications$/);
  await expect(page.getByText("No notifications yet")).toBeVisible();
  await expect(page.locator('[data-artwork="empty-no-notifications"]')).toHaveCount(1);
});

test("match pages advertise their OG image; manifest, sitemap and robots are served", async ({ page, request }) => {
  const match = await e2eDb().match.findFirstOrThrow({ where: { isEntryList: false, status: { not: "CANCELLED" } } });
  await page.goto(`/scrims/${match.id}`);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /opengraph-image/);

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/dashboard" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/leaderboard/bgmi");
  expect(sitemap).toContain(`/scrims/${match.id}`);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/admin/);
  expect(robots).toMatch(/Disallow: \/dashboard/);

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await request.get("/offline.html").then((r) => r.status())).toBe(200);
});

test("private pages are marked noindex", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("the service worker registers and caches only static assets", async ({ page }) => {
  await loginViaUi(page, "9811100302", "/dashboard");
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.goto("/dashboard");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await page.goto("/notifications");
  await page.goto("/dashboard");
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const req of await cache.keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  expect(cached).toContain("/offline.html");
  expect(cached.length).toBeGreaterThan(1);
  for (const p of cached) expect(p === "/offline.html" || p.startsWith("/_next/static/") || p.startsWith("/icons/") || p.startsWith("/art/"), p).toBe(true);
});
