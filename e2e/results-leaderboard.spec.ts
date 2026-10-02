import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

test.describe.configure({ mode: "serial" });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PLAYERS = [
  { phone: "9811100091", name: "Rusher One", uid: "91919191" },
  { phone: "9811100092", name: "Rusher Two", uid: "92929292" },
  { phone: "9811100093", name: "Rusher Three", uid: "93939393" },
];
let matchId: string;

async function as(page: Page, phone: string, returnTo: string) {
  await page.context().clearCookies();
  await loginViaUi(page, phone, returnTo);
  await page.waitForURL((u) => u.pathname !== "/login");
}

test.beforeAll(async () => {
  const db = e2eDb();
  // The seeded Free Fire solo scrim, moved to "results pending" with three confirmed players.
  const match = await db.match.findFirstOrThrow({ where: { title: "Free Fire Solo Rush" } });
  matchId = match.id;
  for (const [i, p] of PLAYERS.entries()) {
    const user = await db.user.create({
      data: {
        phone: `+91${p.phone}`,
        displayName: p.name,
        dateOfBirth: new Date("2000-05-05"),
        gameProfiles: { create: { game: "FREE_FIRE", gameId: p.uid } },
      },
    });
    await db.registration.create({ data: { matchId, userId: user.id, status: "CONFIRMED", position: 100 + i } });
  }
  await db.match.update({
    where: { id: matchId },
    data: { status: "RESULTS_PENDING", startsAt: new Date(Date.now() - 3600_000), registrationClosesAt: new Date(Date.now() - 5400_000) },
  });
});

test("player submits a result, admin approves, the leaderboard updates, reopening removes the points", async ({ page }) => {
  // Player 1 submits placement 1 with 6 kills and a screenshot.
  await as(page, PLAYERS[0]!.phone, `/scrims/${matchId}`);
  await page.goto(`/scrims/${matchId}`);
  const form = page.getByRole("region", { name: "Submit your result" });
  await form.getByLabel("Placement").fill("1");
  await form.getByLabel("Kills").fill("6");
  await form.getByLabel("End-screen screenshot").setInputFiles({ name: "end.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Submit result" }).click();
  await expect(page.getByText("Result submitted. A moderator will review it.")).toBeVisible();

  // Admin reviews: sets player 2 (2nd, 1 kill), marks player 3 as a no-show, approves.
  await as(page, "9999900001", `/admin/results/${matchId}`);
  await page.goto(`/admin/results/${matchId}`);
  const card1 = page.getByRole("article", { name: `Result for ${PLAYERS[0]!.name}` });
  await expect(card1.getByLabel("Placement")).toHaveValue("1");
  await expect(card1.getByRole("img")).toBeVisible();
  const card2 = page.getByRole("article", { name: `Result for ${PLAYERS[1]!.name}` });
  await card2.getByLabel("Placement").fill("1");
  await card2.getByLabel("Kills").fill("1");
  await expect(page.getByRole("alert").filter({ hasText: "Placement conflict: 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and post points" })).toBeDisabled();
  await card2.getByLabel("Placement").fill("2");
  // Nobody starts as a no-show (DECISIONS M22): the admin ticks it.
  const card3 = page.getByRole("article", { name: `Result for ${PLAYERS[2]!.name}` });
  await card3.getByLabel("Did not play (no-show)").check();
  await page.getByRole("button", { name: "Approve and post points" }).click();
  await expect(page.getByText("Results approved and points posted")).toBeVisible();

  // Leaderboard updates immediately.
  await page.goto("/leaderboard/free-fire");
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText(PLAYERS[0]!.name);
  await expect(rows.nth(1)).toContainText("21");
  await expect(rows.nth(2)).toContainText(PLAYERS[1]!.name);
  await expect(rows.nth(2)).toContainText("13");
  // Design: points is the last column, #1 wears the gold crown.
  await expect(page.getByRole("columnheader").last()).toHaveText("Points");
  await expect(rows.nth(1).locator("svg.lucide-crown")).toHaveCount(1);
  await expect(rows.nth(1).getByRole("cell").last()).toHaveText("21");
  await expect(page.getByRole("row", { name: new RegExp(PLAYERS[2]!.name) })).toHaveCount(0);

  // Public results table and the no-show strike.
  await page.goto(`/scrims/${matchId}`);
  await expect(page.getByRole("region", { name: "Results" })).toContainText(PLAYERS[0]!.name);
  const noShow = await e2eDb().user.findUniqueOrThrow({ where: { phone: `+91${PLAYERS[2]!.phone}` } });
  expect(noShow.strikes).toBe(1);

  // Reopen within the dispute window: points and strikes are reversed.
  await page.goto(`/admin/results/${matchId}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reopen results" }).click();
  await expect(page.getByText("Results reopened and points reversed")).toBeVisible();
  await page.goto("/leaderboard/free-fire");
  await expect(page.getByText("No points yet this season")).toBeVisible();
  expect((await e2eDb().user.findUniqueOrThrow({ where: { id: noShow.id } })).strikes).toBe(0);
});
