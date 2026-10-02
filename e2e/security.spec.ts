import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { e2eDb } from "./support/db";

test.describe.configure({ mode: "serial" });

const SECRETS = {
  roomId: "LEAK-ROOM-90909",
  roomPassword: "leak-pass-80808",
  phoneDigits: "9811100401",
  vpaMasked: "le****@okleak",
  rawWebhook: "RAWHOOK-MARKER-7777",
};
let matchId: string;
let victimId: string;

test.beforeAll(async () => {
  const db = e2eDb();
  const admin = await db.user.findUniqueOrThrow({ where: { phone: "+919999900001" } });
  const victim = await db.user.create({
    data: {
      phone: `+91${SECRETS.phoneDigits}`,
      displayName: "Leak Victim",
      dateOfBirth: new Date("1990-01-01"),
      gameProfiles: { create: { game: "FREE_FIRE", gameId: "40140140" } },
      payoutMethod: { create: { kind: "UPI", beneficiaryId: "ben_leak", accountHolderName: "Leak Victim", vpaMasked: SECRETS.vpaMasked } },
    },
  });
  victimId = victim.id;
  const startsAt = new Date(Date.now() + 3 * 3600_000);
  const match = await db.match.create({
    data: {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "Leak Test Scrim",
      startsAt,
      registrationClosesAt: new Date(startsAt.getTime() - 1800_000),
      maxSlots: 10,
      entryFeePaise: 1000,
      status: "REGISTRATION_OPEN",
      roomId: SECRETS.roomId,
      roomPassword: SECRETS.roomPassword,
      createdById: admin.id,
    },
  });
  matchId = match.id;
  const reg = await db.registration.create({ data: { matchId, userId: victim.id, status: "CONFIRMED", position: 1 } });
  await db.payment.create({
    data: { userId: victim.id, matchId, registrationId: reg.id, orderId: "ord_leak", amountPaise: 1000, status: "PAID", expiresAt: new Date(), rawWebhook: { marker: SECRETS.rawWebhook } },
  });
  await db.pointsEntry.create({
    data: { seasonId: (await db.season.findFirstOrThrow({ where: { game: "FREE_FIRE", isActive: true } })).id, userId: victim.id, matchId, points: 15, reason: "scrim" },
  });
});

function publicUrls() {
  return [
    "/",
    "/scrims",
    `/scrims/${matchId}`,
    "/games/free-fire",
    "/leaderboard/free-fire",
    "/tournament/free-fire",
    `/players/${victimId}`,
    // Site search returns the victim and the leak-test match by name; it must still show public fields only.
    "/search?q=Leak",
    "/rules",
    "/faq",
    "/contact",
    "/sitemap.xml",
    "/robots.txt",
    "/api/health",
    `/api/matches/${matchId}/room`,
    "/api/payments/ord_leak",
  ];
}

async function assertNoLeaks(request: APIRequestContext, urls: string[]) {
  for (const url of urls) {
    const res = await request.get(url);
    const body = await res.text();
    for (const [what, secret] of Object.entries(SECRETS)) {
      expect(body.includes(secret), `${url} leaks ${what}`).toBe(false);
    }
  }
}

test("public pages and endpoints never expose credentials, phones, payout details or raw webhooks (anonymous)", async ({ request }) => {
  await assertNoLeaks(request, publicUrls());
});

test("…nor to another logged-in player, including their own dashboard and inbox", async ({ page }) => {
  await loginViaUi(page, "9811100402", "/dashboard");
  await page.waitForURL((u) => u.pathname !== "/login");
  await assertNoLeaks(page.request, [...publicUrls(), "/dashboard", "/notifications", "/teams"]);
});

test("pages send security headers with a nonce-based CSP and render without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/");
  const h = res!.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["strict-transport-security"]).toMatch(/max-age=/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  for (const p of ["/scrims", `/scrims/${matchId}`, "/leaderboard/free-fire", "/tournament/bgmi", "/login"]) await page.goto(p);
  await page.getByLabel("Mobile number").fill("9811100403");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  expect(violations).toEqual([]);
});

test("cross-site POSTs to cookie-authenticated routes are refused", async ({ request }) => {
  const res = await request.post("/api/auth/session", {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: { idToken: "stub:+919811100404" },
  });
  expect(res.status()).toBe(403);
});
