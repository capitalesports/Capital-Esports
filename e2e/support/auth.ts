import type { Page } from "@playwright/test";
import { e2eDb } from "./db";

/**
 * Log in through the real UI using the local OTP stub (code 123456).
 * Session-creation rate limits (5 per phone / 15 min) are covered by integration tests; the e2e
 * suite logs the same admin in many times, so its counters are cleared first.
 */
export async function loginViaUi(page: Page, phone10: string, returnTo = "/dashboard") {
  await e2eDb().rateLimit.deleteMany({ where: { key: { startsWith: "session:" } } });
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Mobile number").fill(phone10);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and log in" }).click();
}
