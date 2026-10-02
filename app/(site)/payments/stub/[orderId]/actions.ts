"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getPaymentGateway } from "@/server/providers/payment-gateway";
import { handlePgWebhook } from "@/server/services/webhooks";
import { signWebhook } from "@/lib/webhook-signature";

const TYPES = {
  SUCCESS: "PAYMENT_SUCCESS_WEBHOOK",
  FAILED: "PAYMENT_FAILED_WEBHOOK",
  USER_DROPPED: "PAYMENT_USER_DROPPED_WEBHOOK",
} as const;

/** Dev/test only: emit a signed Cashfree-shaped webhook for my own order through the real handler. */
export async function simulateStubPayment(form: FormData) {
  const actor = await requireUser();
  const gateway = getPaymentGateway();
  if (gateway.kind !== "stub") throw new AppError("FORBIDDEN", "Test checkout is disabled.");
  const orderId = String(form.get("orderId") ?? "");
  const outcome = String(form.get("outcome") ?? "") as keyof typeof TYPES;
  if (!(outcome in TYPES)) throw new AppError("VALIDATION", "Unknown outcome");
  const payment = await db.payment.findUnique({ where: { orderId } });
  if (!payment || payment.userId !== actor.id) throw new AppError("NOT_FOUND", "Order not found.");

  const body = JSON.stringify({
    data: {
      order: { order_id: orderId, order_amount: payment.amountPaise / 100, order_currency: "INR" },
      payment: {
        cf_payment_id: `stub_${Date.now()}`,
        payment_status: outcome,
        payment_amount: payment.amountPaise / 100,
        payment_currency: "INR",
      },
    },
    event_time: new Date().toISOString(),
    type: TYPES[outcome],
  });
  const ts = String(Date.now());
  await handlePgWebhook(body, signWebhook(gateway.webhookSecret, ts, body), ts);
  redirect(`/payments/return?order_id=${encodeURIComponent(orderId)}`);
}
