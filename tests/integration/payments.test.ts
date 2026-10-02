import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runPaymentExpiryJob } from "@/server/jobs/payment-jobs";
import { STUB_WEBHOOK_SECRET } from "@/server/providers/payment-gateway";
import { cancelMatch } from "@/server/services/matches";
import { startCheckout } from "@/server/services/payments";
import { cancelRegistration, registerForMatch } from "@/server/services/registration";
import { handlePgWebhook } from "@/server/services/webhooks";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { signWebhook } from "@/lib/webhook-signature";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let admin: Actor;

beforeAll(() => {
  process.env.PAYMENTS_ENABLED = "true";
});
afterAll(() => {
  delete process.env.PAYMENTS_ENABLED;
});
beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

function pgWebhook(
  type: string,
  orderId: string,
  opts: { cfPaymentId?: string; secret?: string } = {},
) {
  const status = type.replace("PAYMENT_", "").replace("_WEBHOOK", "");
  const body = JSON.stringify({
    data: {
      order: { order_id: orderId, order_amount: 50, order_currency: "INR" },
      payment: {
        cf_payment_id: opts.cfPaymentId ?? "cf_1",
        payment_status: status,
        payment_amount: 50,
      },
    },
    event_time: "2026-09-27T12:00:00+05:30",
    type,
  });
  const ts = String(Date.now());
  return { body, ts, sig: signWebhook(opts.secret ?? STUB_WEBHOOK_SECRET, ts, body) };
}

function refundWebhook(refundId: string, status = "SUCCESS") {
  const body = JSON.stringify({
    data: {
      refund: { refund_id: refundId, order_id: "x", refund_status: status, refund_amount: 50 },
    },
    type: "REFUND_STATUS_WEBHOOK",
  });
  const ts = String(Date.now());
  return { body, ts, sig: signWebhook(STUB_WEBHOOK_SECRET, ts, body) };
}

const send = (w: { body: string; ts: string; sig: string }) => handlePgWebhook(w.body, w.sig, w.ts);

async function paidMatch(maxSlots = 2) {
  return createMatch(admin.id, { entryFeePaise: 5000, maxSlots, capped: true });
}
const regOf = (matchId: string, userId: string) =>
  testDb().registration.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId } } });
const paymentOf = (registrationId: string) =>
  testDb().payment.findUniqueOrThrow({ where: { registrationId } });

describe("paid registration", () => {
  it("holds the slot as PENDING_PAYMENT and confirms only via a verified webhook", async () => {
    const m = await paidMatch(1);
    const [a, b] = [await createPlayer(), await createPlayer()];
    expect((await registerForMatch(player(a), { matchId: m.id })).status).toBe("PENDING_PAYMENT");
    // The held slot is not given to anyone else.
    expect((await registerForMatch(player(b), { matchId: m.id })).status).toBe("WAITLISTED");

    const reg = await regOf(m.id, a.id);
    const payment = await paymentOf(reg.id);
    expect(payment).toMatchObject({ status: "CREATED", amountPaise: 5000, matchId: m.id });
    expect(reg.paymentId).toBe(payment.id);

    const checkout = await startCheckout(player(a), { matchId: m.id });
    expect(checkout.paymentSessionId).toMatch(/^stub_session_/);
    await expect(startCheckout(player(b), { matchId: m.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(startCheckout(null, { matchId: m.id })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    // The client redirect alone changes nothing.
    expect((await regOf(m.id, a.id)).status).toBe("PENDING_PAYMENT");

    const res = await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", payment.orderId));
    expect(res).toEqual({ status: 200, body: { ok: true, result: "CONFIRMED" } });
    expect((await regOf(m.id, a.id)).status).toBe("CONFIRMED");
    expect(await paymentOf(reg.id)).toMatchObject({ status: "PAID", cfPaymentId: "cf_1" });
  });

  it("rejects tampered or unsigned webhooks and changes nothing", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const { orderId } = await paymentOf((await regOf(m.id, a.id)).id);
    const w = pgWebhook("PAYMENT_SUCCESS_WEBHOOK", orderId);
    expect(
      (await handlePgWebhook(w.body.replace('"order_amount":50', '"order_amount":1'), w.sig, w.ts))
        .status,
    ).toBe(401);
    expect((await handlePgWebhook(w.body, null, w.ts)).status).toBe(401);
    expect(
      (await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", orderId, { secret: "attacker" }))).status,
    ).toBe(401);
    expect((await regOf(m.id, a.id)).status).toBe("PENDING_PAYMENT");
    expect(await testDb().webhookEvent.count()).toBe(0);
  });

  it("replayed webhooks never double-confirm", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const { orderId } = await paymentOf((await regOf(m.id, a.id)).id);
    const w = pgWebhook("PAYMENT_SUCCESS_WEBHOOK", orderId);
    expect((await send(w)).body.result).toBe("CONFIRMED");
    expect((await send(w)).body.result).toBe("DUPLICATE");
    // Same order, different delivery id: state machine ignores it.
    expect(
      (await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", orderId, { cfPaymentId: "cf_other" }))).body
        .result,
    ).toBe("IGNORED");
    expect(await testDb().auditLog.count({ where: { action: "payment.paid" } })).toBe(1);
    // A failure arriving after success is ignored too.
    expect((await send(pgWebhook("PAYMENT_FAILED_WEBHOOK", orderId))).body.result).toBe("IGNORED");
    expect((await regOf(m.id, a.id)).status).toBe("CONFIRMED");
  });

  it("a failed or dropped payment can be retried with a new order while the slot is held", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const reg = await regOf(m.id, a.id);
    const first = await paymentOf(reg.id);
    expect((await send(pgWebhook("PAYMENT_USER_DROPPED_WEBHOOK", first.orderId))).body.result).toBe(
      "FAILED",
    );
    expect((await regOf(m.id, a.id)).status).toBe("PENDING_PAYMENT");
    const retry = await startCheckout(player(a), { matchId: m.id });
    expect(retry.orderId).not.toBe(first.orderId);
    expect((await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", retry.orderId))).body.result).toBe(
      "CONFIRMED",
    );
  });
});

describe("payment expiry job", () => {
  it("frees unpaid slots after 10 minutes and promotes the waitlist into a new payment window", async () => {
    const m = await paidMatch(1);
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    await registerForMatch(player(b), { matchId: m.id });
    expect(await runPaymentExpiryJob(addMinutes(new Date(), 5))).toEqual({
      expired: 0,
      recovered: 0,
    });
    expect(await runPaymentExpiryJob(addMinutes(new Date(), 11))).toEqual({
      expired: 1,
      recovered: 0,
    });
    expect((await regOf(m.id, a.id)).status).toBe("CANCELLED");
    expect((await paymentOf((await regOf(m.id, a.id)).id)).status).toBe("FAILED");
    const promoted = await regOf(m.id, b.id);
    expect(promoted.status).toBe("PENDING_PAYMENT");
    expect((await paymentOf(promoted.id)).status).toBe("CREATED");
    // Idempotent for a's expired payment; b's fresh 10-minute window is still open.
    expect(await runPaymentExpiryJob(addMinutes(new Date(), 5))).toEqual({
      expired: 0,
      recovered: 0,
    });
    expect((await regOf(m.id, b.id)).status).toBe("PENDING_PAYMENT");
  });

  it("a success that arrives after the slot was lost waitlists the player and refunds", async () => {
    const m = await paidMatch(1);
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    const lateOrder = (await paymentOf((await regOf(m.id, a.id)).id)).orderId;
    await runPaymentExpiryJob(addMinutes(new Date(), 11));
    await registerForMatch(player(b), { matchId: m.id }); // b takes the freed slot (PENDING_PAYMENT)

    expect((await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", lateOrder))).body.result).toBe(
      "WAITLISTED_REFUNDED",
    );
    const regA = await regOf(m.id, a.id);
    expect(regA.status).toBe("WAITLISTED");
    const pay = await paymentOf(regA.id);
    expect(pay).toMatchObject({ status: "REFUND_PENDING", refundId: `rf_${pay.id}` });

    expect((await send(refundWebhook(pay.refundId!))).body.result).toBe("REFUNDED");
    expect((await paymentOf(regA.id)).status).toBe("REFUNDED");
    expect((await send(refundWebhook(pay.refundId!))).body.result).toBe("DUPLICATE");
  });

  it("an open-entry scrim confirms a late payment while registration is open (there is always room)", async () => {
    const m = await createMatch(admin.id, { entryFeePaise: 5000, maxSlots: 1 });
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    const lateOrder = (await paymentOf((await regOf(m.id, a.id)).id)).orderId;
    await runPaymentExpiryJob(addMinutes(new Date(), 11));
    expect((await registerForMatch(player(b), { matchId: m.id })).status).toBe("PENDING_PAYMENT");

    expect((await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", lateOrder))).body.result).toBe(
      "CONFIRMED",
    );
    expect((await regOf(m.id, a.id)).status).toBe("CONFIRMED");
  });
});

describe("refunds", () => {
  it("cancelling a paid match refunds every PAID registration", async () => {
    const m = await paidMatch(3);
    const players = [await createPlayer(), await createPlayer(), await createPlayer()];
    for (const p of players) await registerForMatch(player(p), { matchId: m.id });
    for (const p of players.slice(0, 2)) {
      const { orderId } = await paymentOf((await regOf(m.id, p.id)).id);
      await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", orderId, { cfPaymentId: `cf_${p.id}` }));
    }
    const result = await cancelMatch(admin, { matchId: m.id, reason: "Server outage" });
    expect(result.refundsQueued).toBe(2);
    const payments = await testDb().payment.findMany({
      where: { matchId: m.id },
      orderBy: { createdAt: "asc" },
    });
    expect(payments.map((p) => p.status).sort()).toEqual([
      "FAILED",
      "REFUND_PENDING",
      "REFUND_PENDING",
    ]);
    for (const p of payments.filter((x) => x.refundId)) await send(refundWebhook(p.refundId!));
    expect(
      (await testDb().payment.findMany({ where: { matchId: m.id, status: "REFUNDED" } })).length,
    ).toBe(2);
  });

  it("a player who cancels a paid entry is not refunded (DECISIONS M42)", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const reg = await regOf(m.id, a.id);
    await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", (await paymentOf(reg.id)).orderId));
    await cancelRegistration(player(a), { matchId: m.id });
    expect((await regOf(m.id, a.id)).status).toBe("CANCELLED");
    const pay = await paymentOf(reg.id);
    expect(pay.status).toBe("PAID");
    expect(pay.refundId).toBeNull();
  });

  it("an unpaid attempt fails when the player cancels", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const reg = await regOf(m.id, a.id);
    await cancelRegistration(player(a), { matchId: m.id });
    expect((await paymentOf(reg.id)).status).toBe("FAILED");
  });

  it("a refund status other than SUCCESS leaves the payment pending", async () => {
    const m = await paidMatch();
    const a = await createPlayer();
    await registerForMatch(player(a), { matchId: m.id });
    const reg = await regOf(m.id, a.id);
    await send(pgWebhook("PAYMENT_SUCCESS_WEBHOOK", (await paymentOf(reg.id)).orderId));
    await cancelMatch(admin, { matchId: m.id, reason: "Server outage" });
    const pay = await paymentOf(reg.id);
    expect(pay.status).toBe("REFUND_PENDING");
    expect((await send(refundWebhook(pay.refundId!, "PENDING"))).body.result).toBe("IGNORED");
    expect((await paymentOf(reg.id)).status).toBe("REFUND_PENDING");
  });

  it("paid matches stay closed while PAYMENTS_ENABLED is false", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    try {
      const m = await paidMatch();
      await expect(
        registerForMatch(player(await createPlayer()), { matchId: m.id }),
      ).rejects.toMatchObject({ message: expect.stringContaining("coming soon") });
    } finally {
      process.env.PAYMENTS_ENABLED = "true";
    }
  });
});
