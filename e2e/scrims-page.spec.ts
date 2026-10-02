import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { createOpenScrim, istAt, istDay } from "./support/fixtures";

test.describe.configure({ mode: "serial" });

const TODAY_FF = "Scrims Page FF Today";
const TOMORROW_BGMI = "Scrims Page BGMI Tomorrow";
const DAY3_VAL = "Scrims Page Valorant Day 3";

test.beforeAll(async () => {
  await createOpenScrim({ title: TODAY_FF, game: "FREE_FIRE", mode: "SQUAD", maxSlots: 48, minutesFromNow: 1 });
  await createOpenScrim({ title: TOMORROW_BGMI, game: "BGMI", mode: "SQUAD", maxSlots: 64, startsAt: istAt(1, "20:00"), prizePaise: 2_000_00 });
  await createOpenScrim({ title: DAY3_VAL, game: "VALORANT", mode: "FIVE_V_FIVE", maxSlots: 10, startsAt: istAt(2, "21:00"), entryFeePaise: 150_00, prizePaise: 6_000_00 });
});


test.describe("scrims page (desktop, scrims-desktop.png)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("hero, game strip, filter panel, Today's Scrims and Upcoming sections, trust row", async ({ page }) => {
    await page.goto("/scrims");
    await expect(page.getByRole("heading", { level: 1, name: "Scrims" })).toBeVisible();
    await expect(page.getByText("Play Daily Scrims · Improve Skills · Win Real Rewards")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "How scrims work?" })).toBeVisible();
    await expect(page.locator('[data-artwork="hero-freefire"]')).toHaveCount(1);
    await expect(page.locator('[data-artwork="hero-valorant"]')).toHaveCount(1);

    const strip = page.getByRole("navigation", { name: "Filter by game" });
    await expect(strip.getByRole("link", { name: "Free Fire Battle Royale · Clash Squad" })).toBeVisible();
    await expect(strip.getByRole("link", { name: "BGMI Battle Royale · TDM" })).toBeVisible();
    await expect(strip.getByRole("link", { name: "Valorant Tactical · 1v1 · 2v2 · 5v5" })).toBeVisible();

    const dates = page.getByRole("navigation", { name: "Date" }).getByRole("link");
    await expect(dates).toHaveCount(4);
    await expect(dates.first()).toHaveAttribute("aria-current", "date");
    await expect(dates.first()).toHaveAccessibleName(/^Today \d{1,2} [A-Z][a-z]{2}$/);
    await expect(dates.nth(1)).toHaveAccessibleName(/^Tomorrow /);

    for (const label of ["Mode", "Entry Fee", "Prize Pool", "Status"]) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Search scrims…")).toBeVisible();

    await expect(page.getByRole("heading", { level: 2, name: "Today's Scrims" })).toBeVisible();
    await expect(page.getByLabel("Sort by")).toHaveValue("start");
    await expect(page.getByRole("list", { name: "Today's Scrims" }).getByRole("article", { name: TODAY_FF })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Upcoming Scrims\s*\(Next 3 Days\)/ })).toBeVisible();
    const upcoming = page.getByRole("list", { name: "Upcoming scrims" });
    await expect(upcoming.getByRole("article", { name: TOMORROW_BGMI })).toBeVisible();
    await expect(upcoming.getByRole("link", { name: `Register: ${TOMORROW_BGMI}` })).toBeVisible();
    // Seeded "Valorant 5v5 Scrim" hasn't opened registration yet: grey UPCOMING pill with its IST opening time.
    const notOpen = upcoming.getByRole("article", { name: "Valorant 5v5 Scrim" });
    await expect(notOpen.locator('[data-status="upcoming"]')).toHaveText(/upcoming/i);
    await expect(notOpen.getByText(/^Opens (at |\d{1,2} [A-Z][a-z]{2}, )\d{1,2}:\d{2} [AP]M$/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Why play here" }).getByRole("heading", { name: "Regular Scrims" })).toBeVisible();
  });

  test("switching a date chip, filtering by game and following the empty-day link update the list", async ({ page }) => {
    await page.goto("/scrims");
    await page.getByRole("navigation", { name: "Date" }).getByRole("link", { name: /^Tomorrow / }).click();
    await expect(page).toHaveURL(new RegExp(`date=${istDay(1)}`));
    await expect(page.getByRole("heading", { level: 2, name: "Tomorrow's Scrims" })).toBeVisible();
    const tomorrow = page.getByRole("list", { name: "Tomorrow's Scrims" });
    await expect(tomorrow.getByRole("article", { name: TOMORROW_BGMI })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Upcoming Scrims\s*\(Next 2 Days\)/ })).toBeVisible();

    const valorant = page.getByRole("navigation", { name: "Filter by game" }).getByRole("link", { name: /^Valorant/ });
    await valorant.click();
    await expect(page).toHaveURL(/game=valorant/);
    await expect(page).toHaveURL(new RegExp(`date=${istDay(1)}`)); // other filters are kept
    await expect(page.getByRole("navigation", { name: "Filter by game" }).getByRole("link", { name: /^Valorant/ })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("article", { name: TOMORROW_BGMI })).toHaveCount(0);
    await expect(page.getByText("No scrims yet for this day")).toBeVisible();

    await page.getByRole("link", { name: /^See .*\d{1,2} [A-Z][a-z]{2}$/ }).click();
    await expect(page).toHaveURL(new RegExp(`date=${istDay(2)}`));
    await expect(page.getByRole("heading", { level: 2, name: /^Scrims on [A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2}$/ })).toBeVisible();
    await expect(page.getByRole("list", { name: /^Scrims on / }).getByRole("article", { name: DAY3_VAL })).toBeVisible();

    // Clicking the selected game again shows every game.
    await page.getByRole("navigation", { name: "Filter by game" }).getByRole("link", { name: /^Valorant/ }).click();
    await expect(page).not.toHaveURL(/game=/);
  });

  test("dropdown filters, search, sort and Reset live in the URL", async ({ page }) => {
    await page.goto("/scrims");
    await page.getByLabel("Entry Fee", { exact: true }).selectOption("paid");
    await expect(page).toHaveURL(/fee=paid/);
    await expect(page.getByRole("article", { name: TODAY_FF })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Upcoming scrims" }).getByRole("article", { name: DAY3_VAL })).toBeVisible();

    await page.getByLabel("Prize Pool", { exact: true }).selectOption("over-5k");
    await expect(page).toHaveURL(/prize=over-5k/);
    await expect(page).toHaveURL(/fee=paid/);

    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/scrims$/);

    await page.getByPlaceholder("Search scrims…").fill("Valorant Day 3");
    await page.getByPlaceholder("Search scrims…").press("Enter");
    await expect(page).toHaveURL(/q=Valorant\+Day\+3/);
    await expect(page.getByRole("article", { name: TOMORROW_BGMI })).toHaveCount(0);
    await expect(page.getByRole("article", { name: DAY3_VAL })).toBeVisible();

    await page.getByLabel("Sort by").selectOption("prize");
    await expect(page).toHaveURL(/sort=prize/);
    await expect(page).toHaveURL(/q=Valorant/);
  });

  test("View Calendar groups the next days, with the empty-day message", async ({ page }) => {
    await page.goto("/scrims");
    await page.getByRole("link", { name: "View Calendar" }).click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.getByRole("heading", { level: 3, name: new RegExp(`^Tomorrow, `) })).toBeVisible();
    await expect(page.getByRole("list", { name: /^Scrims on Tomorrow/ }).getByRole("article", { name: TOMORROW_BGMI })).toBeVisible();
    await expect(page.getByRole("link", { name: "Grid View" })).toBeVisible();
  });

  test("logged-in navbar: bell, avatar + name + role, account menu", async ({ page }) => {
    await e2eDb().user.create({
      data: { phone: "+919811100901", displayName: "Shubham", dateOfBirth: new Date("2000-01-01"), gameProfiles: { create: { game: "BGMI", gameId: "5140140140" } } },
    });
    await loginViaUi(page, "9811100901", "/scrims");
    await page.waitForURL(/\/scrims/);
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: /^Notifications/ })).toBeVisible();
    await expect(header.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scrims" })).toHaveAttribute("aria-current", "page");
    const account = header.getByRole("button", { name: "Account menu: Shubham" });
    await expect(account).toContainText("Shubham");
    await expect(account).toContainText("Player");
    await account.click();
    await expect(account).toHaveAttribute("aria-expanded", "true");
    for (const item of ["Dashboard", "Profile", "Teams"]) await expect(header.getByRole("link", { name: item, exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Admin panel" })).toHaveCount(0);
    await header.getByRole("link", { name: "Teams", exact: true }).click();
    await expect(page).toHaveURL(/\/teams$/);
    await page.getByRole("banner").getByRole("button", { name: "Account menu: Shubham" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
  });
});

test("mobile: date chips scroll sideways and the filters open in a bottom sheet", async ({ page }) => {
  await page.goto("/scrims");
  await expect(page.getByRole("navigation", { name: "Date" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByLabel("Mode", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Mode", { exact: true }).selectOption("FIVE_V_FIVE");
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/mode=FIVE_V_FIVE/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Filters/ })).toContainText("1");
  await expect(page.getByRole("article", { name: TODAY_FF })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
