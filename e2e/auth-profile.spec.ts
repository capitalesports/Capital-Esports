import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { verifyEmailFor } from "./support/fixtures";
import { pickDob } from "./support/picker";

test.describe.configure({ mode: "serial" });

test("protected pages redirect to login with returnTo", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/);
});

test("wrong OTP shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill("9811100001");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify and log in" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("The code is invalid or has expired");
});

test("new player logs in, completes profile, session persists across reload", async ({ page }) => {
  await loginViaUi(page, "9811100002", "/dashboard");
  // New users land on the profile page first.
  await expect(page).toHaveURL(/\/profile\?returnTo=%2Fdashboard/);
  await expect(page.getByText("Complete your profile to register")).toBeVisible();
  await expect(page.locator('[data-artwork="empty-profile"]')).toBeVisible();

  await page.getByLabel("Display name").fill("Shadow Ace");
  await pickDob(page, "5", "April", "2003");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  // A verified email is still missing (updates go out by email): no Continue yet.
  await expect(page.getByText("Required: add and verify your email")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);
  await verifyEmailFor("9811100002");

  // Name, date of birth and email complete the profile; game IDs are asked for where they are needed.
  await page.reload();
  await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game IDs" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button", { name: "Account menu: Shadow Ace" })).toBeVisible();

  // Creating a team asks for that game's ID first.
  await page.goto("/teams");
  await page.getByLabel("Game", { exact: true }).selectOption({ label: "Free Fire" });
  const ff = page.getByRole("form", { name: "Free Fire ID" });
  await ff.getByLabel("Free Fire UID").fill("55511122");
  await ff.getByLabel("Exact in-game name").fill("Shadow Ace々");
  await ff.getByRole("button", { name: "Add Free Fire ID" }).click();
  await expect(page.getByText("Game ID saved")).toBeVisible();
  await expect(page.getByLabel("Team name")).toBeVisible();

  await page.getByLabel("Game", { exact: true }).selectOption({ label: "Valorant" });
  const val = page.getByRole("form", { name: "Valorant ID" });
  await val.getByLabel("Riot ID").fill("bad-id");
  await val.getByRole("button", { name: "Add Valorant ID" }).click();
  await expect(val.getByText(/Riot ID must look like Name#Tag/)).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("game IDs are unique across users", async ({ page }) => {
  await loginViaUi(page, "9811100003", "/teams");
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto("/teams");
  await page.getByLabel("Game", { exact: true }).selectOption({ label: "Free Fire" });
  const ff = page.getByRole("form", { name: "Free Fire ID" });
  await ff.getByLabel("Free Fire UID").fill("55511122");
  await ff.getByLabel("Exact in-game name").fill("Copycat");
  await ff.getByRole("button", { name: "Add Free Fire ID" }).click();
  await expect(ff.getByText("This Free Fire UID is already linked to another account.")).toBeVisible();
});

test("a banned user cannot log in", async ({ page }) => {
  await e2eDb().user.create({
    data: { phone: "+919811100004", bannedAt: new Date(), banReason: "Teaming in scrims" },
  });
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill("9811100004");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and log in" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("This account is banned");
  await expect(page.locator("main").getByRole("alert")).toContainText("Teaming in scrims");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("logout ends the session", async ({ page }) => {
  await loginViaUi(page, "9811100002", "/profile");
  await expect(page).toHaveURL(/\/profile/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("players cannot open the admin panel", async ({ page }) => {
  await loginViaUi(page, "9811100002", "/admin");
  await page.waitForURL((url) => url.pathname !== "/login");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("the seeded admin can open the admin panel", async ({ page }) => {
  await loginViaUi(page, "9999900001", "/admin");
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto("/admin");
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Users" })).toBeVisible();
});
