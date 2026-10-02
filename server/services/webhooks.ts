import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getPaymentGateway } from "@/server/providers/payment-gateway";
import { getPayoutGateway } from "@/server/providers/payout-gateway";
import type { PaymentEvent, RefundEvent } from "@/lib/payments";
import { verifyWebhookSignature } from "@/lib/webhook-signature";
import { applyPaymentEvent, applyRefundEvent } from "./payments";
import { applyTransferEvent } from "./payouts";

export interface WebhookResult {
  status: number;
  body: { ok: boolean; result?: string; error?: string };
}

const PAYMENT_TYPES: Record<string, PaymentEvent> = {
  PAYMENT_SUCCESS_WEBHOOK: "SUCCESS",
  PAYMENT_FAILED_WEBHOOK: "FAILED",
  PAYMENT_USER_DROPPED_WEBHOOK: "USER_DROPPED",
};

/** Record the event; returns false if we already processed this exact event (replay). */
async function firstTime(source: string, eventKey: string, type: string): Promise<boolean> {
  try {
    await db.webhookEvent.create({ data: { source, eventKey, type } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

async function forget(eventKey: string) {
  await db.webhookEvent.deleteMany({ where: { eventKey } });
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

/**
 * Cashfree PG webhook (payments + refunds). Signature is mandatory; processing is idempotent both via
 * the WebhookEvent log and via state transitions that ignore anything already applied.
 */
export async function handlePgWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): Promise<WebhookResult> {
  const gateway = getPaymentGateway();
  if (!verifyWebhookSignature(gateway.webhookSecret, signature, timestamp, rawBody)) {
    return { status: 401, body: { ok: false, error: "Invalid signature" } };
  }
  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON" } };
  }
  const type = String(payload.type ?? "");
  const data = obj(payload.data);

  if (type in PAYMENT_TYPES) {
    const orderId = String(obj(data.order).order_id ?? "");
    const payment = obj(data.payment);
    const key = `pg:${type}:${orderId}:${String(payment.cf_payment_id ?? "")}`;
    if (!orderId) return { status: 400, body: { ok: false, error: "Missing order_id" } };
    if (!(await firstTime("cashfree-pg", key, type)))
      return { status: 200, body: { ok: true, result: "DUPLICATE" } };
    try {
      const result = await applyPaymentEvent(
        orderId,
        PAYMENT_TYPES[type]!,
        payload,
        payment.cf_payment_id ? String(payment.cf_payment_id) : null,
      );
      return { status: 200, body: { ok: true, result } };
    } catch (e) {
      await forget(key); // let Cashfree retry
      throw e;
    }
  }

  if (type === "REFUND_STATUS_WEBHOOK") {
    const refund = obj(data.refund);
    const refundId = String(refund.refund_id ?? "");
    const status = String(refund.refund_status ?? "") as RefundEvent;
    const key = `pg:${type}:${refundId}:${status}`;
    if (!refundId) return { status: 400, body: { ok: false, error: "Missing refund_id" } };
    if (!(await firstTime("cashfree-pg", key, type)))
      return { status: 200, body: { ok: true, result: "DUPLICATE" } };
    try {
      const result = await applyRefundEvent(refundId, status, { raw: payload });
      return { status: 200, body: { ok: true, result } };
    } catch (e) {
      await forget(key);
      throw e;
    }
  }

  // Other event types (e.g. settlements) are acknowledged and ignored.
  return { status: 200, body: { ok: true, result: "IGNORED" } };
}

/** Cashfree Payouts v2 webhook: TRANSFER_* events update the payout ledger. */
export async function handlePayoutWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): Promise<WebhookResult> {
  const gateway = getPayoutGateway();
  if (!verifyWebhookSignature(gateway.webhookSecret, signature, timestamp, rawBody)) {
    return { status: 401, body: { ok: false, error: "Invalid signature" } };
  }
  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON" } };
  }
  const type = String(payload.type ?? "");
  if (!type.startsWith("TRANSFER_")) return { status: 200, body: { ok: true, result: "IGNORED" } };
  const data = obj(payload.data);
  const transferId = String(data.transfer_id ?? "");
  if (!transferId) return { status: 400, body: { ok: false, error: "Missing transfer_id" } };
  const key = `payout:${type}:${transferId}`;
  if (!(await firstTime("cashfree-payouts", key, type)))
    return { status: 200, body: { ok: true, result: "DUPLICATE" } };
  try {
    const result = await applyTransferEvent(transferId, type, payload);
    return { status: 200, body: { ok: true, result } };
  } catch (e) {
    await forget(key);
    throw e;
  }
}
