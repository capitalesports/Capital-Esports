import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";
import { verifyEmailFor } from "./support/fixtures";
import { pickDob } from "./support/picker";

test.describe.configure({ mode: "serial" });

const ROOM_ID = "E2E-ROOM-5151";
const ROOM_PASS = "e2e-pass-7272";
let matchId: string;

test.beforeAll(async () => {
  const db = e2eDb();
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const startsAt = new Date(Date.now() + 3 * 3600_000);
  const match = await db.match.create({
    data: {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "E2E Solo Scrim",
      startsAt,
      registrationClosesAt: new Date(startsAt.getTime() - 30 * 60_000),
      maxSlots: 10,
      status: "REGISTRATION_OPEN",
      roomId: ROOM_ID,
      roomPassword: ROOM_PASS,
      createdById: admin.id,
    },
  });
  matchId = match.id;
});

test("scrims page lists today + 3 days and filters by game and mode", async ({ page }) => {
  await page.goto("/scrims");
  await expect(page.getByRole("heading", { level: 1, name: "Scrims" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Solo Scrim", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Filter by game" }).getByRole("link", { name: /^BGMI/ }).click();
  await expect(page).toHaveURL(/game=bgmi/);
  await expect(page.getByRole("link", { name: "E2E Solo Scrim", exact: true })).toHaveCount(0);
  await page.goto("/scrims?game=free-fire&mode=SOLO");
  await expect(page.getByRole("link", { name: "E2E Solo Scrim", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Free Fire Evening Squad Scrim", exact: true })).toHaveCount(0);
});

test("registering without a profile sends the player to their profile, naming what is missing", async ({ page }) => {
  await loginViaUi(page, "9811100070", `/scrims/${matchId}`);
  // Brand-new users land on /profile first; go back to the match to try registering.
  await page.waitForURL(/\/profile/);
  await page.goto(`/scrims/${matchId}`);
  const panel = page.getByRole("region", { name: "Registration" });
  await expect(panel).toContainText("Before registering, add your display name, date of birth, verified email");
  await panel.getByRole("link", { name: "Complete profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/profile\\?returnTo=%2Fscrims%2F${matchId}&missing=`));
  await expect(page.getByText("Before you can register, add: display name, date of birth, verified email.")).toBeVisible();
});

test("login -> profile -> register -> room credentials appear only after the reveal window", async ({ page }) => {
  await loginViaUi(page, "9811100071", `/scrims/${matchId}`);
  await page.waitForURL(/\/profile/);
  await page.getByLabel("Display name").fill("Solo Sniper");
  await pickDob(page, "2", "February", "2002");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await verifyEmailFor("9811100071");
  await page.reload();
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/scrims/${matchId}$`));

  // The registration box only has the Register button; the player's own Free Fire UID and exact
  // in-game name are entered inside the pop-up (and saved to the profile).
  const panel = page.getByRole("region", { name: "Registration" });
  await expect(panel.getByRole("form", { name: "Free Fire ID" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Register" }).click();
  const dialog = page.getByRole("dialog", { name: "Free Fire Solo registration" });
  await expect(dialog.getByLabel("Team name")).toHaveCount(0);
  await dialog.getByLabel("Your Free Fire UID").fill("71717171");
  await dialog.getByLabel("Your exact in-game name").fill("Solo Sniper");  await dialog.getByRole("button", { name: "Confirm registration" }).click();
  await expect(panel.getByRole("status")).toContainText("Confirmed — you have a slot");

  // The room is already shared: a confirmed player sees it at once (DECISIONS M20), fetched from
  // the room API only; it is never in any page's HTML.
  await expect(page.getByTestId("room-room-id")).toHaveText(ROOM_ID);
  for (const path of [`/scrims/${matchId}`, "/scrims", "/dashboard", "/games/free-fire"]) {
    const html = await (await page.request.get(path)).text();
    expect(html, path).not.toContain(ROOM_PASS);
    expect(html, path).not.toContain(ROOM_ID);
  }
  await expect(page.getByTestId("room-password")).toHaveText(ROOM_PASS);

  // The dashboard shows them too.
  await page.goto("/dashboard");
  await expect(page.getByTestId("room-password").first()).toHaveText(ROOM_PASS);

  // Someone who is not registered never gets them.
  const anon = await page.context().browser()!.newContext();
  const res = await anon.request.get(`http://localhost:${process.env.E2E_PORT ?? 3101}/api/matches/${matchId}/room`);
  expect(res.status()).toBe(401);
  expect(await res.text()).not.toContain(ROOM_PASS);
  await anon.close();
});
