import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

test.describe.configure({ mode: "serial" });

const PLAYERS = [
  { phone: "9811100081", name: "Cap Alpha", bgmi: "8100000081", ign: "CapA" },
  { phone: "9811100082", name: "Mate Two", bgmi: "8100000082", ign: "MateB" },
  { phone: "9811100083", name: "Mate Three", bgmi: "8100000083", ign: "MateC" },
  { phone: "9811100084", name: "Mate Four", bgmi: "8100000084", ign: "MateD" },
];
let matchId: string;

async function switchUser(page: Page, phone: string, returnTo: string) {
  await page.context().clearCookies();
  await loginViaUi(page, phone, returnTo);
  await page.waitForURL((u) => u.pathname !== "/login");
}

test.beforeAll(async () => {
  const db = e2eDb();
  for (const p of PLAYERS) {
    await db.user.create({
      data: {
        phone: `+91${p.phone}`,
        displayName: p.name,
        dateOfBirth: new Date("2001-01-01"),
        gameProfiles: { create: { game: "BGMI", gameId: p.bgmi, ign: p.ign } },
      },
    });
  }
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const startsAt = new Date(Date.now() + 4 * 3600_000);
  matchId = (
    await db.match.create({
      data: {
        game: "BGMI",
        mode: "SQUAD",
        title: "E2E Squad Scrim",
        startsAt,
        registrationClosesAt: new Date(startsAt.getTime() - 30 * 60_000),
        maxSlots: 16,
        status: "REGISTRATION_OPEN",
        createdById: admin.id,
      },
    })
  ).id;
});

test("the captain alone enters the squad by game ID and exact in-game name; the slot confirms at once", async ({ page }) => {
  await switchUser(page, PLAYERS[0]!.phone, `/scrims/${matchId}`);
  await page.goto(`/scrims/${matchId}`);
  const panel = page.getByRole("region", { name: "Registration" });
  await panel.getByRole("button", { name: "Register team" }).click();
  // The pop-up: team name, Player 1 is the IGL (the captain, from his profile), then players 2-4.
  const dialog = page.getByRole("dialog", { name: "BGMI Squad registration" });
  await expect(dialog).toContainText("Player 1 · IGL (team leader)");
  // The IGL's own ID is pre-filled from the profile (and can be corrected right here).
  await expect(dialog.getByLabel("Your BGMI Character ID")).toHaveValue("8100000081");
  await expect(dialog.getByLabel("Your exact in-game name")).toHaveValue("CapA");
  await dialog.getByLabel("Team name").fill("E2E Wolves");
  // Player 2 has an account (linked, gets points); players 3 and 4 have none.
  const mates = [
    { id: PLAYERS[1]!.bgmi, ign: PLAYERS[1]!.ign },
    { id: "8100000093", ign: "Guest Três" },
    { id: "8100000094", ign: "guest FOUR" },
  ];
  for (const [i, m] of mates.entries()) {
    const row = dialog.getByRole("group", { name: `Player ${i + 2}` });
    await row.getByLabel("BGMI Character ID").fill(m.id);
    await row.getByLabel("Exact in-game name").fill(m.ign);
  }
  await dialog.getByRole("button", { name: "Register team" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole("status")).toContainText("Confirmed — you have a slot");

  const reg = await e2eDb().registration.findFirstOrThrow({ where: { matchId }, include: { members: true } });
  expect(reg).toMatchObject({ status: "CONFIRMED", teamName: "E2E Wolves" });
  expect(reg.members.map((m) => m.ign).sort()).toEqual(["CapA", "Guest Três", "MateB", "guest FOUR"].sort());

  // The linked teammate sees the team on the match page without confirming anything.
  await switchUser(page, PLAYERS[1]!.phone, `/scrims/${matchId}`);
  await page.goto(`/scrims/${matchId}`);
  await expect(page.getByRole("region", { name: "Registration" })).toContainText("You play for E2E Wolves");
});
