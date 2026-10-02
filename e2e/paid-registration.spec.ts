import { expect, test, type Page } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

test.describe.configure({ mode: "serial" });

let matchId: string;

async function playerLogin(page: Page, phone10: string, uid: string, name: string) {
  await e2eDb().user.upsert({
    where: { phone: `+91${phone10}` },
    create: { phone: `+91${phone10}`, displayName: name, dateOfBirth: new Date("1999-09-09"), gameProfiles: { create: { game: "FREE_FIRE", gameId: uid } } },
    update: {},
  });
  await page.context().clearCookies();
  await loginViaUi(page, phone10, `/scrims/${matchId}`);
  await page.waitForURL(new RegExp(`/scrims/${matchId}`));
}

test.beforeAll(async () => {
  const db = e2eDb();
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const startsAt = new Date(Date.now() + 5 * 3600_000);
  matchId = (
    await db.match.create({
      data: {
        game: "FREE_FIRE",
        mode: "SOLO",
        title: "E2E Paid Solo",
        startsAt,
        registrationClosesAt: new Date(startsAt.getTime() - 1800_000),
        maxSlots: 10,
        entryFeePaise: 5000,
        prizePaise: 40000,
        status: "REGISTRATION_OPEN",
        createdById: admin.id,
      },
    })
  ).id;
});

test("a paid registration is confirmed only after the (sandbox) payment webhook", async ({ page }) => {
  await playerLogin(page, "9811100201", "20120120", "Payer One");
  const panel = page.getByRole("region", { name: "Registration" });
  await panel.getByRole("button", { name: "Register" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Register & pay ₹50" }).click();

  // Checkout opens; the slot is held but not confirmed yet.
  await expect(page).toHaveURL(/\/payments\/stub\/ord_/);
  const user = await e2eDb().user.findUniqueOrThrow({ where: { phone: "+919811100201" } });
  const reg = await e2eDb().registration.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: user.id } } });
  expect(reg.status).toBe("PENDING_PAYMENT");
  await page.goto(`/scrims/${matchId}`);
  await expect(panel.getByRole("status")).toContainText("Waiting for payment");
  await panel.getByRole("button", { name: "Pay ₹50 entry fee" }).click();

  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page).toHaveURL(/\/payments\/return\?order_id=ord_/);
  await expect(page.getByRole("status")).toHaveText("Payment received. Your slot is confirmed!");
  expect((await e2eDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe("CONFIRMED");
  expect((await e2eDb().payment.findUniqueOrThrow({ where: { registrationId: reg.id } })).status).toBe("PAID");

  await page.getByRole("link", { name: "Back to the match" }).click();
  await expect(panel.getByRole("status")).toContainText("Confirmed — you have a slot");
});

test("an abandoned checkout leaves the slot held but unconfirmed", async ({ page }) => {
  await playerLogin(page, "9811100202", "20220220", "Payer Two");
  await page.getByRole("region", { name: "Registration" }).getByRole("button", { name: "Register" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Register & pay ₹50" }).click();
  await expect(page).toHaveURL(/\/payments\/stub\//);
  await page.getByRole("button", { name: "Close checkout without paying" }).click();
  await expect(page.getByRole("status")).toContainText("did not go through");
  const user = await e2eDb().user.findUniqueOrThrow({ where: { phone: "+919811100202" } });
  const reg = await e2eDb().registration.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: user.id } } });
  expect(reg.status).toBe("PENDING_PAYMENT");
});

test("the payment status endpoint is private to the payer", async ({ page }) => {
  const payment = await e2eDb().payment.findFirstOrThrow({ where: { matchId } });
  await page.context().clearCookies();
  const res = await page.request.get(`/api/payments/${payment.orderId}`);
  expect(res.status()).toBe(401);
});
