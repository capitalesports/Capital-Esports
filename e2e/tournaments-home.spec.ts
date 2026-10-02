import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { createPublishedTournament } from "./support/fixtures";
import { pickIstDateTime } from "./support/picker";

test.describe.configure({ mode: "serial" });

async function asAdmin(page: Page) {
  await page.context().clearCookies();
  await loginViaUi(page, "9999900001", "/admin/tournaments");
  await page.waitForURL((u) => u.pathname !== "/login");
}

/** A confirmed team with a full roster on a sign-up list (arranged directly in the DB). */
async function enterTeam(
  entryId: string,
  game: "BGMI" | "VALORANT",
  name: string,
  position: number,
  idBase: number,
) {
  const db = e2eDb();
  const size = game === "VALORANT" ? 5 : 4;
  const users = [];
  for (let i = 0; i < size; i++) {
    const n = idBase + i;
    users.push(
      await db.user.create({
        data: {
          phone: `+9197${String(n).padStart(8, "0")}`,
          displayName: `${name} P${i + 1}`,
          dateOfBirth: new Date("2001-01-01"),
          gameProfiles: {
            create:
              game === "VALORANT"
                ? {
                    game,
                    gameId: `${name.toLowerCase()}p${i}#e2e`,
                    ign: `${name}P${i}#E2E`,
                    region: "AP",
                  }
                : { game, gameId: String(700000000 + n), ign: `${name}${i}` },
          },
        },
      }),
    );
  }
  const team = await db.team.create({ data: { game, name, captainId: users[0]!.id } });
  const reg = await db.registration.create({
    data: {
      matchId: entryId,
      userId: users[0]!.id,
      teamId: team.id,
      status: "CONFIRMED",
      position,
    },
  });
  await db.registrationMember.createMany({
    data: users.map((u) => ({
      registrationId: reg.id,
      matchId: entryId,
      userId: u.id,
      status: "CONFIRMED" as const,
    })),
  });
  return team;
}

test("BGMI lobby-points tournament: 3 linked matches, cumulative standings, published winners on the home carousel", async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto("/admin/tournaments");
  // Wait for hydration so the form submits through its action, not as a plain HTML form (cold CI server).
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Game").selectOption("BGMI");
  await page.getByLabel("Title").fill("E2E BGMI Weekly");
  await pickIstDateTime(page, "Tournament start", "Tomorrow", "8 PM");
  await page.getByLabel("Prize pool (₹)").fill("3000");
  await page.getByRole("button", { name: "Create tournament" }).click();
  await expect(page).toHaveURL(/\/admin\/tournaments\/[a-z0-9]+$/);
  const tournamentUrl = page.url();
  const t = await e2eDb().tournament.findFirstOrThrow({ where: { title: "E2E BGMI Weekly" } });

  const teams = [
    await enterTeam(t.entryMatchId!, "BGMI", "Alpha", 1, 1000),
    await enterTeam(t.entryMatchId!, "BGMI", "Bravo", 2, 1010),
    await enterTeam(t.entryMatchId!, "BGMI", "Charlie", 3, 1020),
  ];

  const lobby = page.getByRole("region", { name: "Lobby matches" });
  await lobby.getByLabel("How many").fill("3");
  await lobby.getByRole("button", { name: "Add matches" }).click();
  await expect(page.getByText("Lobby matches added")).toBeVisible();
  await lobby.getByRole("button", { name: "Lock entries" }).click();
  await expect(page.getByText("Entries locked into every lobby match")).toBeVisible();

  // Results for the 3 lobby matches (placement, kills) per team, approved.
  const plan = [
    [
      [1, 8],
      [2, 3],
      [3, 1],
    ],
    [
      [3, 2],
      [1, 10],
      [2, 0],
    ],
    [
      [2, 5],
      [3, 1],
      [1, 4],
    ],
  ];
  const matches = await e2eDb().match.findMany({
    where: { tournamentId: t.id, isEntryList: false },
    orderBy: { startsAt: "asc" },
  });
  expect(matches).toHaveLength(3);
  for (const [mi, m] of matches.entries()) {
    const regs = await e2eDb().registration.findMany({ where: { matchId: m.id } });
    expect(regs).toHaveLength(3);
    for (const [ti, team] of teams.entries()) {
      const reg = regs.find((r) => r.teamId === team.id)!;
      await e2eDb().result.create({
        data: {
          matchId: m.id,
          registrationId: reg.id,
          teamId: team.id,
          placement: plan[mi]![ti]![0]!,
          kills: plan[mi]![ti]![1]!,
          approvedAt: new Date(),
        },
      });
    }
    await e2eDb().match.update({
      where: { id: m.id },
      data: { status: "COMPLETED", resultsApprovedAt: new Date() },
    });
  }

  // Public page shows cumulative standings: (placement + kills) × 2 summed.
  await page.goto("/tournament/bgmi");
  await expect(page.getByRole("heading", { level: 1, name: "E2E BGMI Weekly" })).toBeVisible();
  const rows = page.getByRole("region", { name: "Standings" }).getByRole("row");
  await expect(rows.nth(1)).toContainText("Alpha");
  await expect(rows.nth(1)).toContainText("104");
  await expect(rows.nth(2)).toContainText("Bravo");
  await expect(rows.nth(2)).toContainText("102");
  await expect(rows.nth(3)).toContainText("Charlie");
  await expect(rows.nth(3)).toContainText("84");

  // Publish winners -> home carousel.
  await page.goto(tournamentUrl);
  await page
    .getByRole("region", { name: "Publish winners" })
    .getByRole("button", { name: "Publish winners" })
    .click();
  await expect(page.getByText("Winners published to the home carousel")).toBeVisible();
  await page.goto("/");
  // "Last Week's Winners" shows the newest published podium per game first: this BGMI tournament.
  const carousel = page.getByRole("region", { name: "Tournament winners" });
  const slide = carousel.getByRole("group", { name: /^1 of / });
  await expect(slide.getByText("E2E BGMI Weekly")).toBeVisible();
  await expect(slide.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(slide.getByText("Bravo", { exact: true })).toBeVisible();
  await expect(slide.getByText("Charlie", { exact: true })).toBeVisible();
});

test("Valorant 8-team bracket renders after generation", async ({ page }) => {
  const db = e2eDb();
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const startsAt = new Date(Date.now() + 2 * 86400_000);
  const weekOf = new Date(
    Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate()),
  );
  const t = await db.tournament.create({
    data: {
      game: "VALORANT",
      title: "E2E Val Cup",
      format: "BRACKET",
      mode: "FIVE_V_FIVE",
      bracketSize: 8,
      startsAt,
      weekOf,
      prizePoolPaise: 800000,
    },
  });
  const entry = await db.match.create({
    data: {
      game: "VALORANT",
      kind: "TOURNAMENT",
      mode: "FIVE_V_FIVE",
      title: "E2E Val Cup — sign-up",
      startsAt,
      registrationClosesAt: new Date(startsAt.getTime() - 1800_000),
      maxSlots: 8,
      status: "REGISTRATION_OPEN",
      isEntryList: true,
      tournamentId: t.id,
      createdById: admin.id,
    },
  });
  await db.tournament.update({ where: { id: t.id }, data: { entryMatchId: entry.id } });
  for (let i = 1; i <= 8; i++) await enterTeam(entry.id, "VALORANT", `Seed${i}`, i, 2000 + i * 10);

  await asAdmin(page);
  await page.goto(`/admin/tournaments/${t.id}`);
  await expect(
    page.getByRole("region", { name: "Bracket" }).getByText("8/8 entries confirmed"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate bracket" }).click();
  await expect(page.getByText("Bracket generated")).toBeVisible();

  await page.goto("/tournament/valorant");
  const bracket = page.getByRole("region", { name: "Tournament bracket" });
  await expect(bracket.getByText("Quarterfinals")).toBeVisible();
  await expect(bracket.getByText("Semifinals")).toBeVisible();
  await expect(bracket.getByText("Final", { exact: true })).toBeVisible();
  await expect(bracket.getByText("Seed1", { exact: true })).toBeVisible();
  await expect(bracket.getByText("Seed8", { exact: true })).toBeVisible();
});

test.describe("winners carousel", () => {
  // Three slides whatever else ran: Free Fire (seeded last week), plus older BGMI and Valorant podiums.
  test.beforeAll(async () => {
    await createPublishedTournament("BGMI", 3, "Carousel BGMI Cup", "Carousel Bravo");
    await createPublishedTournament("VALORANT", 2, "Carousel Val Cup", "Carousel Victor");
  });

  const index = (page: Page) =>
    page.getByRole("region", { name: "Tournament winners" }).getAttribute("data-index");

  test("auto-advances every 7 seconds", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    const carousel = page.getByRole("region", { name: "Tournament winners" });
    await expect(carousel).toHaveAttribute("data-index", "0");
    await page.mouse.move(0, 0);
    await page.clock.fastForward(6_500);
    expect(await index(page)).toBe("0");
    await page.clock.fastForward(1_000);
    await expect(carousel).toHaveAttribute("data-index", "1");
    await page.clock.fastForward(7_100);
    await expect(carousel).toHaveAttribute("data-index", "2");
  });

  test("pauses while hovered and resumes after", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    const carousel = page.getByRole("region", { name: "Tournament winners" });
    await carousel.hover();
    await expect(carousel).toHaveAttribute("data-paused", "true");
    await page.clock.fastForward(20_000);
    await expect(carousel).toHaveAttribute("data-index", "0");
    await page.mouse.move(0, 0);
    await expect(carousel).toHaveAttribute("data-paused", "false");
    await page.clock.fastForward(7_100);
    await expect(carousel).toHaveAttribute("data-index", "1");
  });

  test("dots and arrows navigate manually", async ({ page }) => {
    await page.goto("/");
    const carousel = page.getByRole("region", { name: "Tournament winners" });
    const count = await carousel.getByRole("button", { name: /^Show slide/ }).count();
    expect(count).toBeGreaterThanOrEqual(3);
    await carousel.getByRole("button", { name: `Show slide ${count}` }).click();
    await expect(carousel).toHaveAttribute("data-index", String(count - 1));
    await expect(carousel.getByRole("button", { name: `Show slide ${count}` })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await carousel.getByRole("button", { name: "Next slide" }).click();
    await expect(carousel).toHaveAttribute("data-index", "0");
    await carousel.getByRole("button", { name: "Previous slide" }).click();
    await expect(carousel).toHaveAttribute("data-index", String(count - 1));
    await carousel.getByRole("button", { name: "Show slide 2" }).click();
    await expect(carousel).toHaveAttribute("data-index", "1");
  });

  test("does not auto-advance with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await page.goto("/");
    const carousel = page.getByRole("region", { name: "Tournament winners" });
    await page.clock.fastForward(30_000);
    await expect(carousel).toHaveAttribute("data-index", "0");
  });
});

test("static pages render admin-editable content", async ({ page }) => {
  await e2eDb().siteContent.upsert({
    where: { key: "faq" },
    create: { key: "faq", body: "## Custom FAQ heading\n\nEdited by the admin." },
    update: { body: "## Custom FAQ heading\n\nEdited by the admin." },
  });
  await e2eDb().siteContent.upsert({
    where: { key: "rules.BGMI" },
    create: { key: "rules.BGMI", body: "BGMI custom rule text" },
    update: { body: "BGMI custom rule text" },
  });
  await page.goto("/faq");
  await expect(page.getByRole("heading", { name: "Custom FAQ heading" })).toBeVisible();
  await page.goto("/rules?game=bgmi");
  await expect(page.getByText("BGMI custom rule text")).toBeVisible();
  for (const path of ["/terms", "/privacy", "/refund-policy"]) {
    await page.goto(path);
    await expect(page.locator("main h2").first()).toBeVisible();
  }
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("E2E Tester");
  await page.getByLabel("How can we reach you?").fill("tester@example.com");
  await page.getByLabel("Message").fill("Testing the contact form end to end.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks! Your message is with the team.")).toBeVisible();
  expect(await e2eDb().contactMessage.count({ where: { name: "E2E Tester" } })).toBe(1);
});
