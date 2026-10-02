import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { pickIstDateTime } from "./support/picker";

test.describe.configure({ mode: "serial" });

async function loginAsAdmin(page: Page) {
  await loginViaUi(page, "9999900001", "/admin");
  await page.waitForURL((url) => url.pathname !== "/login");
}

const TITLE = `E2E Squad Scrim ${Date.now()}`;

test("admin creates a scrim, clones it for 3 days, opens registration, sets room credentials and cancels one", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/matches/new");

  await page.getByLabel("Game").selectOption("FREE_FIRE");
  await page.getByLabel("Mode").selectOption("SQUAD");
  await page.getByLabel("Title").fill(TITLE);
  await pickIstDateTime(page, "Start time", "Tomorrow", "9 PM");
  await page.getByLabel("Prize (₹)").fill("100");
  await page.getByRole("button", { name: "Create match" }).click();

  await expect(page).toHaveURL(/\/admin\/matches\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
  const matchUrl = page.url();

  // Clone daily for 3 days.
  await page.getByLabel("Same match daily for the next N days").fill("3");
  await page.getByRole("button", { name: "Clone daily" }).click();
  await expect(page.getByText("Cloned for the next 3 day(s)")).toBeVisible();

  // Open registration.
  await page.getByRole("button", { name: "Open registration" }).click();
  await expect(page.getByText("Registration open", { exact: true })).toBeVisible();

  // Room credentials.
  await page.getByLabel("Room ID").fill("4455667");
  await page.getByLabel("Room password").fill("ffsquad");
  await page.getByRole("button", { name: "Save room credentials" }).click();
  await expect(page.getByText("Room credentials saved")).toBeVisible();
  await expect(page.getByText("Already set.")).toBeVisible();

  // The list shows the original plus 3 clones.
  await page.goto("/admin/matches");
  await expect(page.getByRole("link", { name: TITLE })).toHaveCount(4);

  // Cancel one of the clones.
  const clone = await e2eDb().match.findFirstOrThrow({ where: { title: TITLE, status: "UPCOMING" }, orderBy: { startsAt: "desc" } });
  await page.goto(`/admin/matches/${clone.id}`);
  await page.getByLabel("Reason").fill("Not enough squads");
  await page.getByRole("button", { name: "Cancel match" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByText("Match cancelled")).toBeVisible();
  await expect(page.getByText("Cancelled: Not enough squads")).toBeVisible();

  // Everything is in the audit log.
  await page.goto("/admin/audit?action=match.");
  for (const action of ["match.create", "match.clone", "match.status", "match.roomCredentials", "match.cancel"]) {
    await expect(page.getByRole("cell", { name: action, exact: true }).first()).toBeVisible();
  }
  const actions = await e2eDb().auditLog.findMany({ where: { action: { startsWith: "match." }, actorId: { not: null } } });
  expect(actions.filter((a) => a.action === "match.clone")).toHaveLength(3);
  expect(page.url()).not.toBe(matchUrl);
});

test("a moderator cannot reach Users or Content", async ({ page }) => {
  await e2eDb().user.create({
    data: {
      phone: "+919811100050",
      role: "MODERATOR",
      displayName: "Mod One",
      dateOfBirth: new Date("1995-01-01"),
      gameProfiles: { create: { game: "BGMI", gameId: "5551112222", ign: "ModOne" } },
    },
  });
  await loginViaUi(page, "9811100050", "/admin");
  await expect(page).toHaveURL(/\/admin$/);

  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Matches" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Content" })).toHaveCount(0);

  for (const path of ["/admin/users", "/admin/content", "/admin/audit"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  const ok = await page.goto("/admin/matches");
  expect(ok?.status()).toBe(200);
});
