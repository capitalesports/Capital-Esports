import { expect, test } from "@playwright/test";
import { e2eDb } from "./support/db";
import { createOpenScrim, istMondayWeeksAgo } from "./support/fixtures";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = e2eDb();
  // Starting "now" keeps them in today's IST row whatever time the suite runs.
  await createOpenScrim({
    title: "Home Today FF Scrim",
    game: "FREE_FIRE",
    mode: "SOLO",
    maxSlots: 48,
    minutesFromNow: 0,
  });
  await createOpenScrim({
    title: "Home Today BGMI Scrim",
    game: "BGMI",
    mode: "SQUAD",
    maxSlots: 16,
    minutesFromNow: 0,
  });
  await createOpenScrim({
    title: "Home Tomorrow Open Scrim",
    game: "FREE_FIRE",
    mode: "SOLO",
    maxSlots: 48,
    minutesFromNow: 26 * 60,
  });

  // This week's Free Fire tournament with open sign-ups (other specs only create BGMI/Valorant ones).
  const weekOf = istMondayWeeksAgo(0);
  if (!(await db.tournament.findFirst({ where: { game: "FREE_FIRE", weekOf } }))) {
    const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    const t = await db.tournament.create({
      data: {
        game: "FREE_FIRE",
        title: "Home FF Weekly",
        format: "LOBBY_POINTS",
        mode: "SQUAD",
        prizePoolPaise: 50_000_00,
        weekOf,
        startsAt,
      },
    });
    const entry = await db.match.create({
      data: {
        game: "FREE_FIRE",
        kind: "TOURNAMENT",
        mode: "SQUAD",
        title: "Home FF Weekly — sign-up",
        startsAt,
        registrationClosesAt: new Date(startsAt.getTime() - 1_800_000),
        maxSlots: 12,
        status: "REGISTRATION_OPEN",
        isEntryList: true,
        tournamentId: t.id,
        createdById: admin.id,
      },
    });
    await db.tournament.update({ where: { id: t.id }, data: { entryMatchId: entry.id } });
  }
});

test.describe("home page (desktop, home-desktop.png)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("navbar: links, Games and More dropdowns (incl. Past seasons), Login and Get Started", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    const nav = header.getByRole("navigation", { name: "Main" });
    for (const label of ["Home", "Scrims", "Tournament", "Leaderboard"])
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Get Started" })).toHaveAttribute(
      "href",
      /^\/signup/,
    );
    await nav.getByRole("button", { name: "Games" }).click();
    for (const [name, slug] of [
      ["Free Fire", "free-fire"],
      ["BGMI", "bgmi"],
      ["Valorant", "valorant"],
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute(
        "href",
        `/games/${slug}`,
      );
    }
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "More" }).click();
    for (const name of ["Rules", "FAQ", "Contact"])
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Past seasons" }).click();
    await expect(page).toHaveURL(/\/leaderboard#past-seasons$/);
    await expect(page.getByRole("heading", { name: "Past seasons" })).toBeVisible();
  });

  test("hero: heading, subline, seeded demo stats, Get Started, panels with taglines linking to game pages", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.getByRole("region", { name: "Capital Esports" });
    await expect(hero.getByText("India's biggest")).toBeVisible();
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText(/Capital\s*Esports/);
    await expect(
      hero.getByText("Play Daily Scrims · Weekly Tournaments · Climb the Leaderboard"),
    ).toBeVisible();
    for (const [value, label] of [
      ["50K+", "Active Players"],
      ["1K+", "Tournaments"],
      ["₹10L+", "Total Prize Pool"],
    ]) {
      await expect(hero.getByText(value, { exact: true })).toBeVisible();
      await expect(hero.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(hero.getByRole("link", { name: "Get Started" })).toHaveAttribute(
      "href",
      "/signup?returnTo=%2Fdashboard",
    );
    for (const [slug, copy] of [
      ["free-fire", /^Free Fire: Squad up, Survive & dominate\./],
      ["bgmi", /^BGMI: Tactics, Skills & chicken dinner\./],
      ["valorant", /^Valorant: Teamwork, Aim & win\./],
    ] as const) {
      await expect(hero.getByRole("link", { name: copy })).toHaveAttribute(
        "href",
        `/games/${slug}`,
      );
    }
    await expect(hero.locator('[data-artwork="hero-bgmi"]')).toHaveCount(1);
    await expect(hero.locator('[data-artwork="bg-valorant"]')).toHaveCount(1);
  });

  test("Watch Trailer is hidden while unset and appears once an admin sets the link", async ({
    page,
  }) => {
    const db = e2eDb();
    const key = "home.trailer";
    await page.goto("/");
    const hero = page.getByRole("region", { name: "Capital Esports" });
    await expect(hero.getByRole("link", { name: "Watch Trailer" })).toHaveCount(0);
    await db.siteContent.upsert({
      where: { key },
      create: { key, body: "https://www.youtube.com/watch?v=e2e" },
      update: { body: "https://www.youtube.com/watch?v=e2e" },
    });
    try {
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Capital Esports" })
          .getByRole("link", { name: "Watch Trailer" }),
      ).toHaveAttribute("href", "https://www.youtube.com/watch?v=e2e");
    } finally {
      await db.siteContent.update({ where: { key }, data: { body: "" } });
    }
  });

  test("game strip, Open & Upcoming Matches chips (today and later), View All Matches", async ({
    page,
  }) => {
    await page.goto("/");
    const strip = page.getByRole("navigation", { name: "Games" });
    await expect(
      strip.getByRole("link", { name: /^Free Fire Daily Scrims & Tournaments/ }),
    ).toHaveAttribute("href", "/games/free-fire");
    await expect(
      strip.getByRole("link", { name: /^BGMI Daily Scrims & Tournaments/ }),
    ).toHaveAttribute("href", "/games/bgmi");
    await expect(
      strip.getByRole("link", { name: /^Valorant Competitive 1v1, 2v2 & 5v5/ }),
    ).toHaveAttribute("href", "/games/valorant");

    const today = page.getByRole("region", { name: "Open & Upcoming Matches" });
    await expect(today.getByRole("link", { name: "View All Matches" })).toHaveAttribute(
      "href",
      "/scrims",
    );
    const row = today.getByRole("list", { name: "Open and upcoming matches" });
    await expect(row.getByRole("article", { name: "Home Today FF Scrim" })).toBeVisible();
    // Registration open for a later day shows too, not only today's matches.
    await expect(row.getByRole("article", { name: "Home Tomorrow Open Scrim" })).toBeVisible();
    const total = await row.getByRole("article").count();
    await today.getByRole("button", { name: "BGMI" }).click();
    await expect(today.getByRole("button", { name: "BGMI" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(row.getByRole("article", { name: "Home Today BGMI Scrim" })).toBeVisible();
    await expect(row.getByRole("article", { name: "Home Today FF Scrim" })).toHaveCount(0);
    for (const title of await row
      .getByRole("article")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))) {
      await expect(
        row.getByRole("article", { name: title! }).getByText("BGMI", { exact: true }),
      ).toBeVisible();
    }
    await today.getByRole("button", { name: "All Games" }).click();
    await expect(row.getByRole("article")).toHaveCount(total);

  });

  test("This Week's Tournaments: cards link to the game's tournament page; a game without one says Announcing soon", async ({
    page,
  }) => {
    await page.goto("/");
    const week = page.getByRole("region", { name: "This Week's Tournaments" });
    await expect(week.getByRole("article")).toHaveCount(3);
    const ff = week.getByRole("article", { name: "Free Fire weekly tournament" });
    await expect(ff.getByText("Weekly Championship")).toBeVisible();
    await expect(ff.getByText("₹50,000")).toBeVisible();
    await expect(ff.getByText("Prize Pool")).toBeVisible();
    await expect(ff.getByText("4 Squad")).toBeVisible();
    await expect(ff.locator('[data-artwork="card-tournament-freefire"]')).toHaveCount(1);
    await expect(ff.getByRole("link", { name: "Register Now" })).toHaveAttribute(
      "href",
      "/tournament/free-fire",
    );
    for (const article of await week.locator('article[data-empty="true"]').all()) {
      await expect(article.getByText("Announcing soon")).toBeVisible();
      await expect(article.getByRole("link")).toHaveCount(0);
    }
    await expect(week.getByRole("link", { name: "View All" })).toHaveAttribute(
      "href",
      "/tournament",
    );
  });

  test("Last Week's Winners, leaderboard tabs without a page load, Why Play", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 2, name: "Last Week's Winners" }),
    ).toBeVisible();
    const winners = page.getByRole("region", { name: "Tournament winners" });
    await expect(winners.getByText("Seed Last Week Cup").first()).toBeAttached();

    const lb = page.getByRole("region", { name: "Leaderboard" });
    await expect(lb.getByText("(Current season)")).toBeVisible();
    await expect(lb.getByRole("tab", { name: "Free Fire" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(lb.getByRole("link", { name: "View Full Leaderboard" })).toHaveAttribute(
      "href",
      "/leaderboard/free-fire",
    );
    let navigations = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navigations++);
    await lb.getByRole("tab", { name: "Valorant" }).click();
    await expect(lb.getByRole("tab", { name: "Valorant" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(lb.getByRole("tabpanel")).toBeVisible();
    await expect(lb.getByRole("link", { name: "View Full Leaderboard" })).toHaveAttribute(
      "href",
      "/leaderboard/valorant",
    );
    expect(navigations).toBe(0);
    await expect(page).toHaveURL(/\/$/);

    const why = page.getByRole("region", { name: "Why Play on Our Platform?" });
    for (const t of ["Fair & Secure", "Regular Tournaments", "Real Rewards", "Active Community"])
      await expect(why.getByRole("heading", { name: t })).toBeVisible();
  });

  test("partners row appears in the footer (home and tournament pages) once a sponsor logo exists", async ({
    page,
  }) => {
    const sponsor = await e2eDb().sponsor.create({
      data: { name: "Acme Energy", logoUrl: "/icons/192", order: 1, active: true },
    });
    try {
      for (const path of ["/", "/tournament/bgmi"]) {
        await page.goto(path);
        const footer = page.getByRole("contentinfo");
        await expect(footer.getByRole("heading", { name: "Our Partners" })).toBeVisible();
        await expect(footer.getByRole("img", { name: "Acme Energy" })).toHaveAttribute(
          "src",
          "/icons/192",
        );
      }
    } finally {
      await e2eDb().sponsor.delete({ where: { id: sponsor.id } });
    }
  });
});

test("home stacks on mobile: hero panels and card rows scroll sideways, no horizontal page scroll", async ({
  page,
}) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Every section fits the viewport width (rows scroll inside themselves, sections never widen).
  const wide = await page.evaluate(() =>
    [...document.querySelectorAll("main section")]
      .filter((s) => s.getBoundingClientRect().right > window.innerWidth + 1)
      .map((s) => s.getAttribute("aria-labelledby") ?? s.getAttribute("aria-label")),
  );
  expect(wide).toEqual([]);
  for (const name of ["Games", "Open and upcoming matches"]) {
    const scrolls = await page
      .getByRole(name === "Games" ? "group" : "list", { name, exact: true })
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls, name).toBe(true);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
});
