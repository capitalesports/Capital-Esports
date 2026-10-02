import { expect, test } from "@playwright/test";
import { createOpenScrim } from "./support/fixtures";

test.describe("design shell (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("navbar matches the design: links, Games and More dropdowns, search, Login + Get Started", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    const nav = header.getByRole("navigation", { name: "Main" });
    for (const label of ["Home", "Scrims", "Tournament", "Leaderboard"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Get Started" })).toBeVisible();

    const games = nav.getByRole("button", { name: "Games" });
    await games.click();
    await expect(games).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(games).toHaveAttribute("aria-expanded", "false");
    await expect(games).toBeFocused();
    await games.click();
    await nav.getByRole("link", { name: "BGMI" }).click();
    await expect(page).toHaveURL(/\/games\/bgmi$/);
    await expect(nav.getByRole("button", { name: "Games" })).toHaveAttribute("aria-expanded", "false");

    await nav.getByRole("button", { name: "More" }).click();
    await nav.getByRole("link", { name: "FAQ" }).click();
    await expect(page).toHaveURL(/\/faq$/);

    // No search box in the header (DECISIONS M21).
    await expect(page.getByRole("banner").getByRole("searchbox")).toHaveCount(0);
  });

  test("uses the design tokens and fonts", async ({ page }) => {
    await page.goto("/scrims");
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const h1 = getComputedStyle(document.querySelector("h1")!);
      return { bg: body.backgroundColor, color: body.color, h1Font: h1.fontFamily, bodyFont: body.fontFamily };
    });
    expect(styles.bg).toBe("rgb(11, 11, 13)");
    expect(styles.color).toBe("rgb(245, 245, 245)");
    expect(styles.h1Font).toMatch(/Barlow/i);
    expect(styles.bodyFont).toMatch(/Inter/i);
  });

  test("footer: partners row hidden without logos, design link bar, labelled social icons", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("heading", { name: "Our Partners" })).toHaveCount(0);
    await expect(footer.getByText("India's Biggest Esports Platform")).toBeVisible();
    const links = footer.getByRole("navigation", { name: "Footer" });
    for (const label of ["Home", "Scrims", "Tournament", "Leaderboard", "Games", "Rules", "FAQ", "Contact"]) await expect(links.getByRole("link", { name: label, exact: true })).toBeVisible();
    await links.getByRole("link", { name: "Games", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible();
    const follow = page.getByRole("contentinfo").getByRole("region", { name: "Follow us" });
    await expect(follow.getByRole("img", { name: /Instagram/ }).or(follow.getByRole("link", { name: /Instagram/ }))).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(/All rights reserved/)).toBeVisible();
  });
});

test("artwork slots keep their size whether the file is delivered (image) or not (placeholder)", async ({ page }) => {
  await page.goto("/leaderboard");
  const slots = page.locator("[data-artwork^=banner-]");
  expect(await slots.count()).toBeGreaterThanOrEqual(3);
  const box = await slots.first().boundingBox();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(40);
});

test("mobile menu has the same destinations and no search box", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("searchbox")).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Valorant" })).toBeVisible();
  await dialog.getByRole("link", { name: "Leaderboard" }).click();
  await expect(page).toHaveURL(/\/leaderboard$/);
});

test("match cards follow the design: game, mode, time, prize, entry, slots bar, Join Now, card art", async ({ page }) => {
  const m = await createOpenScrim({ title: "Design Card Squad Scrim", game: "FREE_FIRE", mode: "SQUAD", maxSlots: 12 });
  // Select the match's own IST day so it renders in the day section even if the run is near midnight.
  const day = new Date(m.startsAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  await page.goto(`/scrims?game=free-fire&date=${day}`);
  const card = page.getByRole("article", { name: "Design Card Squad Scrim" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Free Fire", { exact: true })).toBeVisible();
  await expect(card.getByText("Squad", { exact: true })).toBeVisible();
  // Card times drop the "IST" suffix (DECISIONS M26).
  await expect(card.getByText(/\d{2}:\d{2} (AM|PM) · (Today|Tomorrow)/)).toBeVisible();
  await expect(card.getByText("Prize Pool")).toBeVisible();
  await expect(card.getByText("Entry Fee")).toBeVisible();
  // Open entry (DECISIONS M11): the bar shows the lobby being filled; more lobbies open when needed.
  await expect(card.getByRole("progressbar", { name: "Current lobby filled" })).toBeVisible();
  await expect(card.getByText(/\d+ joined · 12 per lobby/)).toBeVisible();
  await expect(card.locator('[data-artwork="card-match-freefire"]')).toHaveCount(1);
  await expect(card.getByRole("link", { name: /^(Join Now|Register): Design Card Squad Scrim$/ })).toBeVisible();
  await expect(card.locator('[data-status="open"]')).toHaveText(/Registration open/i);
});
