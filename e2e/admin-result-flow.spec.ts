import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { pickIstDateTime } from "./support/picker";

test("admin creates a match, approves its result, and the leaderboard updates", async ({ page }) => {
  const title = `Flow BGMI Solo ${Date.now()}`;
  await loginViaUi(page, "9999900001", "/admin/matches/new");
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.goto("/admin/matches/new");
  await page.getByLabel("Game").selectOption("BGMI");
  await page.getByLabel("Mode").selectOption("SOLO");
  await page.getByLabel("Title").fill(title);
  await pickIstDateTime(page, "Start time", "Tomorrow", "8 PM");
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const matchId = page.url().split("/").pop()!;

  // Two players registered and the match played (arranged directly: the cron moves real matches).
  const db = e2eDb();
  const players = [];
  for (const [i, name] of ["Flow Ace", "Flow Bolt"].entries()) {
    players.push(
      await db.user.create({
        data: {
          phone: `+91981110050${i}`,
          displayName: name,
          dateOfBirth: new Date("2001-01-01"),
          gameProfiles: { create: { game: "BGMI", gameId: `55500050${i}`, ign: name.replace(" ", "") } },
        },
      }),
    );
  }
  for (const [i, p] of players.entries()) await db.registration.create({ data: { matchId, userId: p.id, status: "CONFIRMED", position: i + 1 } });
  await db.match.update({ where: { id: matchId }, data: { status: "RESULTS_PENDING" } });

  await page.goto(`/admin/results/${matchId}`);
  for (const [i, p] of players.entries()) {
    const card = page.getByRole("article", { name: `Result for ${p.displayName}` });
    await card.getByLabel("Placement").fill(String(i + 1));
    await card.getByLabel("Kills").fill(String(5 - i * 3));
  }
  await page.getByRole("button", { name: "Approve and post points" }).click();
  await expect(page.getByText("Results approved and points posted")).toBeVisible();

  await page.goto("/leaderboard/bgmi");
  // Flow Ace: 15 + 5 = 20; Flow Bolt: 12 + 2 = 14
  await expect(page.getByRole("row", { name: /Flow Ace/ })).toContainText("20");
  await expect(page.getByRole("row", { name: /Flow Bolt/ })).toContainText("14");
});
