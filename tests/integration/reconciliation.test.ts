import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

// Provider-side truth for this test file.
const provider = {
  orders: new Map<string, string>(),
  refunds: new Map<string, string>(),
  transfers: new Map<string, string>(),
};
vi.mock("@/server/providers/payment-gateway", () => ({
  STUB_WEBHOOK_SECRET: "x",
  RazorpayPaymentGateway: class {},
  getRazorpayGateway: () => null,
  getPaymentGateway: () => ({
    kind: "stub",
    requiresPhone: false,
    webhookSecret: "x",
    createOrder: async (i: { orderId: string }) => ({ paymentSessionId: `s_${i.orderId}` }),
    fetchOrderStatus: async (o: { orderId: string }) => provider.orders.get(o.orderId) ?? "ACTIVE",
    refund: async () => ({ status: "PENDING" }),
    fetchRefundStatus: async (r: { refundId: string }) =>
      provider.refunds.get(r.refundId) ?? "PENDING",
  }),
}));
vi.mock("@/server/providers/payout-gateway", () => ({
  STUB_PAYOUT_WEBHOOK_SECRET: "y",
  getPayoutGateway: () => ({
    kind: "stub",
    webhookSecret: "y",
    addBeneficiary: async () => {},
    transfer: async () => ({ cfTransferId: "cf", status: "RECEIVED", raw: {} }),
    getTransferStatus: async (id: string) => provider.transfers.get(id) ?? "RECEIVED",
  }),
}));

const { runPaymentExpiryJob, runReconciliationJob } = await import("@/server/jobs/payment-jobs");
const { registerForMatch } = await import("@/server/services/registration");
const { startCheckout } = await import("@/server/services/payments");

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let adminId: string;

beforeAll(() => {
  process.env.PAYMENTS_ENABLED = "true";
});
afterAll(() => {
  delete process.env.PAYMENTS_ENABLED;
});
beforeEach(async () => {
  await resetDb();
  provider.orders.clear();
  provider.refunds.clear();
  provider.transfers.clear();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

async function pendingEntry() {
  const m = await createMatch(adminId, { entryFeePaise: 5000, maxSlots: 2 });
  const p = await createPlayer();
  await registerForMatch(player(p), { matchId: m.id });
  await startCheckout(player(p), { matchId: m.id });
  const reg = await testDb().registration.findUniqueOrThrow({
    where: { matchId_userId: { matchId: m.id, userId: p.id } },
  });
  const payment = await testDb().payment.findUniqueOrThrow({ where: { registrationId: reg.id } });
  return { m, p, reg, payment };
}

describe("expiry re-checks the provider", () => {
  it("confirms instead of expiring when Cashfree says the order is PAID", async () => {
    const { reg, payment } = await pendingEntry();
    provider.orders.set(payment.orderId, "PAID");
    expect(await runPaymentExpiryJob(addMinutes(new Date(), 11))).toEqual({
      expired: 0,
      recovered: 1,
    });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe(
      "CONFIRMED",
    );
  });
});

describe("nightly reconciliation", () => {
  it("flags and applies paid orders we missed", async () => {
    const { reg, payment } = await pendingEntry();
    expect(await runReconciliationJob()).toMatchObject({ flagged: 0 });
    provider.orders.set(payment.orderId, "PAID");
    expect(await runReconciliationJob()).toMatchObject({ flagged: 1 });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe(
      "CONFIRMED",
    );
    const flag = await testDb().reconciliationFlag.findFirstOrThrow();
    expect(flag).toMatchObject({ kind: "payment", ours: "CREATED", theirs: "PAID" });
  });

  it("completes refunds and transfers the provider finished", async () => {
    const { payment } = await pendingEntry();
    await testDb().payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING", refundId: `rf_${payment.id}` },
    });
    provider.refunds.set(`rf_${payment.id}`, "SUCCESS");
    const u = await createPlayer();
    const payout = await testDb().payout.create({
      data: { userId: u.id, place: 1, amountPaise: 1000, status: "PROCESSING", transferId: "tr_x" },
    });
    provider.transfers.set("tr_x", "SUCCESS");
    expect(await runReconciliationJob()).toMatchObject({ flagged: 2 });
    expect((await testDb().payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      "REFUNDED",
    );
    expect((await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      "SUCCESS",
    );
    // Nothing left to fix the next night.
    expect(await runReconciliationJob()).toMatchObject({ flagged: 0 });
  });
});
