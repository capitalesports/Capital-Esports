import { expect, test } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

const PLAYER_PHONE = "9811100701";

test.describe.configure({ mode: "serial" });

test("a player requests deletion, an admin approves it and the account is erased (DECISIONS M39)", async ({
  page,
}) => {
  const db = e2eDb();
  await db.user.upsert({
    where: { phone: `+91${PLAYER_PHONE}` },
    update: { deletedAt: null, displayName: "Leaving Larry" },
    create: {
      phone: `+91${PLAYER_PHONE}`,
      displayName: "Leaving Larry",
      dateOfBirth: new Date("2001-01-01"),
      email: "e2e-leaving@test.in",
      emailVerifiedAt: new Date(),
    },
  });

  // Player: no direct delete button any more, only a request.
  await loginViaUi(page, PLAYER_PHONE, "/profile");
  await page.waitForURL((u) => u.pathname === "/profile");
  const section = page.getByRole("region", { name: "Delete account" });
  await expect(section.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
  await section.getByRole("button", { name: "Request account deletion" }).click();
  await page.getByLabel("Reason (optional)").fill("Taking a break");
  await page.getByRole("button", { name: "Send deletion request" }).click();
  await expect(page.getByText("Deletion request sent. An admin will review it.")).toBeVisible();
  await expect(section.getByText(/You asked to delete your account on/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Cancel deletion request" })).toBeVisible();

  // Admin: approves from the new page.
  await page.context().clearCookies();
  await loginViaUi(page, "9999900001", "/admin/deletion-requests");
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.goto("/admin/deletion-requests");
  const card = page.getByRole("listitem").filter({ hasText: "Leaving Larry" });
  await expect(card).toContainText("Taking a break");
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Approve and delete" }).click();
  await expect(page.getByText("Account deleted")).toBeVisible();
  await expect(page.getByRole("region", { name: /Pending/ })).toContainText("No pending requests.");

  const after = await db.user.findUniqueOrThrow({ where: { phone: `+91${PLAYER_PHONE}` } });
  expect(after.deletedAt).not.toBeNull();
  expect(after.displayName).toBeNull();
});
