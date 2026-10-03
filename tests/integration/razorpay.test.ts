import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runPaymentExpiryJob } from "@/server/jobs/payment-jobs";
import { cancelMatch } from "@/server/services/matches";
import { confirmRazorpayPayment, executeRefunds, startCheckout } from "@/server/services/payments";
import { registerForMatch } from "@/server/services/registration";
import { handleRazorpayWebhook } from "@/server/services/webhooks";
import { razorpayCheckoutSignature, razorpayWebhookSignature } from "@/lib/razorpay-signature";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

/** DECISIONS M43: Razorpay checkout against a fake Razorpay API (no network). */

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "rzp_test_secret";
const WEBHOOK_SECRET = "rzp_webhook_secret";
const FEE = 7000; // ₹70

interface FakeOrder {
  id: string;
  amount: number;
  receipt: string;
  status: string;
}
interface FakePayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
}
interface FakeRefund {
  id: string;
  payment_id: string;
  amount: number;
  receipt: string;
  status: string;
}

const fake = {
  orders: new Map<string, FakeOrder>(),
  payments: new Map<string, FakePayment>(),
  refunds: [] as FakeRefund[],
  calls: [] as { method: string; path: string; body: unknown }[],
  seq: 0,
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.host !== "api.razorpay.com") return realFetch(input, init);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`)
    return reply(401, {});
  const method = init?.method ?? "GET";
  const path = url.pathname.replace(/^\/v1/, "");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  fake.calls.push({ method, path, body });
  let m: RegExpMatchArray | null;
  if (method === "POST" && path === "/orders") {
    const order = {
      id: `order_${++fake.seq}`,
      amount: body.amount,
      receipt: body.receipt,
      status: "created",
    };
    fake.orders.set(order.id, order);
    return reply(200, order);
  }
  if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)$/))) {
    const o = fake.orders.get(m[1]!);
    return o ? reply(200, o) : reply(404, {});
  }
  if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
    return reply(200, { items: [...fake.payments.values()].filter((p) => p.order_id === m![1]) });
  }
  if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) {
    const p = fake.payments.get(m[1]!);
    return p ? reply(200, p) : reply(404, {});
  }
  if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
    const p = fake.payments.get(m[1]!)!;
    p.status = "captured";
    fake.orders.get(p.order_id)!.status = "paid";
    return reply(200, p);
  }
  if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)\/refunds$/))) {
    return reply(200, { items: fake.refunds.filter((r) => r.payment_id === m![1]) });
  }
  if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
    const r = {
      id: `rfnd_${++fake.seq}`,
      payment_id: m[1]!,
      amount: body.amount,
      receipt: body.receipt,
      status: "pending",
    };
    fake.refunds.push(r);
    return reply(200, r);
  }
  return reply(404, {});
}

/** Razorpay takes the money for an order (what happens inside the popup). */
function pay(orderId: string, opts: { amount?: number; status?: string } = {}) {
  const p = {
    id: `pay_${++fake.seq}`,
    order_id: orderId,
    amount: opts.amount ?? fake.orders.get(orderId)!.amount,
    currency: "INR",
    status: opts.status ?? "captured",
  };
  fake.payments.set(p.id, p);
  if (p.status === "captured") fake.orders.get(orderId)!.status = "paid";
  return {
    p,
    response: {
      razorpay_order_id: orderId,
      razorpay_payment_id: p.id,
      razorpay_signature: razorpayCheckoutSignature(KEY_SECRET, orderId, p.id),
    },
  };
}

function webhook(
  event: string,
  entities: Record<string, unknown>,
  opts: { secret?: string; id?: string } = {},
) {
  const body = JSON.stringify({ event, payload: entities });
  return handleRazorpayWebhook(
    body,
    razorpayWebhookSignature(opts.secret ?? WEBHOOK_SECRET, body),
    opts.id ?? `evt_${++fake.seq}`,
  );
}

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let admin: Actor;
const regOf = (matchId: string, userId: string) =>
  testDb().registration.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId } } });
const paymentOf = (registrationId: string) =>
  testDb().payment.findUniqueOrThrow({ where: { registrationId } });

/** A player with no phone (Google sign-up) registers for a ₹70 match and opens checkout. */
async function checkout(maxSlots = 4) {
  const m = await createMatch(admin.id, { entryFeePaise: FEE, maxSlots, capped: true });
  const u = await createPlayer();
  await testDb().user.update({ where: { id: u.id }, data: { phone: null } });
  expect((await registerForMatch(player(u), { matchId: m.id })).status).toBe("PENDING_PAYMENT");
  const c = await startCheckout(player(u), { matchId: m.id });
  return { m, u, c };
}

beforeAll(() => {
  process.env.PAYMENTS_ENABLED = "true";
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  vi.stubGlobal("fetch", fakeFetch);
});
afterAll(() => {
  delete process.env.PAYMENTS_ENABLED;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await resetDb();
  fake.orders.clear();
  fake.payments.clear();
  fake.refunds.length = 0;
  fake.calls.length = 0;
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

describe("Razorpay checkout (DECISIONS M43)", () => {
  it("creates one order for the match's fee; the player needs no phone and sends no amount", async () => {
    const { m, u, c } = await checkout();
    const orders = fake.calls.filter((x) => x.method === "POST" && x.path === "/orders");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.body).toMatchObject({ amount: FEE, currency: "INR", receipt: c.orderId });
    expect(c.razorpay).toMatchObject({
      keyId: KEY_ID,
      orderId: c.paymentSessionId,
      amountPaise: FEE,
      name: "Capital Esports",
    });
    // Opening checkout again reuses the same order.
    const again = await startCheckout(player(u), { matchId: m.id });
    expect(again.paymentSessionId).toBe(c.paymentSessionId);
    expect(fake.calls.filter((x) => x.path === "/orders")).toHaveLength(1);
  });

  it("confirms the slot after a verified, captured payment for the exact amount", async () => {
    const { m, u, c } = await checkout();
    const { p, response } = pay(c.paymentSessionId);
    expect(await confirmRazorpayPayment(player(u), response)).toEqual({
      orderId: c.orderId,
      result: "CONFIRMED",
    });
    const reg = await regOf(m.id, u.id);
    expect(reg.status).toBe("CONFIRMED");
    expect(await paymentOf(reg.id)).toMatchObject({ status: "PAID", cfPaymentId: p.id });
    // A replay (or the webhook arriving later) changes nothing.
    expect((await confirmRazorpayPayment(player(u), response)).result).toBe("IGNORED");
  });

  it("captures an authorized payment before confirming", async () => {
    const { m, u, c } = await checkout();
    const { p, response } = pay(c.paymentSessionId, { status: "authorized" });
    await confirmRazorpayPayment(player(u), response);
    expect(fake.payments.get(p.id)!.status).toBe("captured");
    expect((await regOf(m.id, u.id)).status).toBe("CONFIRMED");
  });

  it("rejects a bad signature, a different amount, someone else's order and bad input", async () => {
    const { m, u, c } = await checkout();
    const { response } = pay(c.paymentSessionId);
    await expect(
      confirmRazorpayPayment(player(u), { ...response, razorpay_signature: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const cheap = pay(c.paymentSessionId, { amount: 100 });
    await expect(confirmRazorpayPayment(player(u), cheap.response)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const stranger = await createPlayer();
    await expect(confirmRazorpayPayment(player(stranger), response)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(confirmRazorpayPayment(null, response)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      confirmRazorpayPayment(player(u), { razorpay_order_id: c.paymentSessionId }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect((await regOf(m.id, u.id)).status).toBe("PENDING_PAYMENT");
  });
});

describe("Razorpay webhook", () => {
  it("requires a valid signature", async () => {
    const r = await webhook("order.paid", {}, { secret: "wrong" });
    expect(r.status).toBe(401);
  });

  it("order.paid confirms the slot once; replays are ignored", async () => {
    const { m, u, c } = await checkout();
    const { p } = pay(c.paymentSessionId);
    const entities = {
      payment: { entity: p },
      order: { entity: fake.orders.get(c.paymentSessionId) },
    };
    expect((await webhook("order.paid", entities, { id: "evt_same" })).body.result).toBe(
      "CONFIRMED",
    );
    expect((await webhook("order.paid", entities, { id: "evt_same" })).body.result).toBe(
      "DUPLICATE",
    );
    expect((await regOf(m.id, u.id)).status).toBe("CONFIRMED");
  });

  it("flags money for an order we don't know, and a payment that doesn't match the order", async () => {
    fake.orders.set("order_unknown", {
      id: "order_unknown",
      amount: FEE,
      receipt: "x",
      status: "created",
    });
    const stray = pay("order_unknown").p;
    expect((await webhook("payment.captured", { payment: { entity: stray } })).body.result).toBe(
      "FLAGGED",
    );

    const { m, u, c } = await checkout();
    const cheap = pay(c.paymentSessionId, { amount: 100 }).p;
    expect((await webhook("payment.captured", { payment: { entity: cheap } })).body.result).toBe(
      "MISMATCH",
    );
    expect((await regOf(m.id, u.id)).status).toBe("PENDING_PAYMENT");
    expect(await testDb().reconciliationFlag.count()).toBe(2);
  });

  it("payment.failed is only acknowledged (the order stays open for another try)", async () => {
    const { m, u } = await checkout();
    expect((await webhook("payment.failed", { payment: { entity: {} } })).body.result).toBe(
      "IGNORED",
    );
    expect((await regOf(m.id, u.id)).status).toBe("PENDING_PAYMENT");
  });
});

describe("Razorpay refunds and recovery", () => {
  it("cancelling the match refunds through Razorpay once, and refund.processed closes it", async () => {
    const { m, u, c } = await checkout();
    const { p, response } = pay(c.paymentSessionId);
    await confirmRazorpayPayment(player(u), response);
    await cancelMatch(admin, { matchId: m.id, reason: "Server outage" });

    const payment = await paymentOf((await regOf(m.id, u.id)).id);
    expect(payment.status).toBe("REFUND_PENDING");
    expect(fake.refunds).toEqual([
      expect.objectContaining({ payment_id: p.id, amount: FEE, receipt: payment.refundId }),
    ]);
    // Retrying the refund never refunds twice.
    await executeRefunds([payment]);
    expect(fake.refunds).toHaveLength(1);

    const refund = { ...fake.refunds[0]!, status: "processed" };
    expect((await webhook("refund.processed", { refund: { entity: refund } })).body.result).toBe(
      "REFUNDED",
    );
    expect((await testDb().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "REFUNDED",
    );
  });

  it("the expiry job recovers a payment whose callback and webhook never arrived", async () => {
    const { m, u, c } = await checkout();
    const { p } = pay(c.paymentSessionId);
    const res = await runPaymentExpiryJob(addMinutes(new Date(), 30));
    expect(res.recovered).toBe(1);
    const reg = await regOf(m.id, u.id);
    expect(reg.status).toBe("CONFIRMED");
    expect((await paymentOf(reg.id)).cfPaymentId).toBe(p.id);
  });
});
