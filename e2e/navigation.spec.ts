import { expect, test } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/",
  "/scrims",
  "/tournament",
  "/tournament/free-fire",
  "/tournament/bgmi/past",
  "/leaderboard",
  "/leaderboard/valorant",
  "/games/bgmi",
  "/rules",
  "/faq",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/contact",
  "/login",
];

test.describe("routes render", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`GET ${route}`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status(), route).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
    });
  }

  test("unknown game slug is a 404", async ({ page }) => {
    const res = await page.goto("/games/pubg");
    expect(res?.status()).toBe(404);
  });
});

test("mobile menu navigates between sections", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Scrims" }).click();
  await expect(page).toHaveURL(/\/scrims$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Scrims");
});

test("scrims filters by game with its game strip; leaderboard pages keep the switcher chips", async ({ page }) => {
  await page.goto("/scrims");
  await expect(page.getByRole("navigation", { name: "Game", exact: true })).toHaveCount(0);
  const strip = page.getByRole("navigation", { name: "Filter by game" });
  await strip.getByRole("link", { name: /^BGMI/ }).click();
  await expect(page).toHaveURL(/game=bgmi/);
  await expect(page.getByRole("navigation", { name: "Filter by game" }).getByRole("link", { name: /^BGMI/ })).toHaveAttribute("aria-current", "true");
  await page.goto("/leaderboard/bgmi");
  await expect(page.getByRole("navigation", { name: "Game", exact: true }).getByRole("link", { name: "BGMI" })).toHaveAttribute("aria-current", "page");
});

test("dark theme is the default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
