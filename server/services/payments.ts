import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { siteUrlServer } from "@/server/env";
import { AppError } from "@/server/errors";
import {
  getPaymentGateway,
  getRazorpayGateway,
  RazorpayPaymentGateway,
} from "@/server/providers/payment-gateway";
import { parseInput } from "@/server/validation";
import {
  nextPaymentStatus,
  nextRefundStatus,
  PAYMENT_WINDOW_MINUTES,
  type PaymentEvent,
  type RefundEvent,
} from "@/lib/payments";
import { takesEveryone } from "@/lib/lobbies";
import { verifyRazorpayCheckoutSignature } from "@/lib/razorpay-signature";
import { SITE_NAME } from "@/lib/site";
import { PHONE_FOR_MONEY_MESSAGE, PHONE_ITEM } from "@/lib/profile";
import { assertUser, type Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { notify, type NotificationEvent } from "./notify";

const newOrderId = () => `ord_${randomUUID().replace(/-/g, "")}`;

/**
 * Put a registration into PENDING_PAYMENT (it holds the slot) with a fresh CREATED payment
 * that expires in 10 minutes. Called inside the registration transaction.
 */
export async function enterPendingPayment(
  tx: Tx,
  reg: { id: string; userId: string },
  match: { id: string; entryFeePaise: number },
  now = new Date(),
) {
  const earlier = await tx.payment.findUnique({ where: { registrationId: reg.id } });
  if (earlier?.status === "PAID") {
    // Already paid (e.g. a paid side left waiting for an opponent, then placed): no second charge.
    await tx.registration.update({
      where: { id: reg.id },
      data: { status: "CONFIRMED", cancelledAt: null, paymentId: earlier.id },
    });
    return earlier;
  }
  if (earlier?.status === "REFUND_PENDING") {
    throw new AppError(
      "CONFLICT",
      "This entry's earlier payment is being refunded. Try again once the refund completes.",
    );
  }
  await tx.registration.update({
    where: { id: reg.id },
    data: { status: "PENDING_PAYMENT", cancelledAt: null },
  });
  const data = {
    userId: reg.userId,
    matchId: match.id,
    orderId: newOrderId(),
    amountPaise: match.entryFeePaise,
    status: "CREATED" as const,
    sessionId: null,
    cfPaymentId: null,
    expiresAt: addMinutes(now, PAYMENT_WINDOW_MINUTES),
    paidAt: null,
  };
  const payment = await tx.payment.upsert({
    where: { registrationId: reg.id },
    create: { ...data, registrationId: reg.id },
    update: data,
  });
  await tx.registration.update({ where: { id: reg.id }, data: { paymentId: payment.id } });
  return payment;
}

/**
 * Open (or resume) checkout for my PENDING_PAYMENT registration. Creates the provider's order once
 * (Cashfree payment_session_id or Razorpay order id, kept in Payment.sessionId) for the amount on our
 * Payment row; a failed/abandoned attempt within the window gets a new order. The browser never
 * sends an amount (DECISIONS M43).
 */
export async function startCheckout(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertUser(actor);
  const { matchId } = parseInput(z.object({ matchId: z.string().min(1) }), input);
  const reg = await db.registration.findUnique({
    where: { matchId_userId: { matchId, userId: me.id } },
    include: {
      user: { select: { phone: true, email: true, displayName: true } },
      match: { select: { title: true } },
    },
  });
  if (!reg || reg.status !== "PENDING_PAYMENT")
    throw new AppError("NOT_FOUND", "There is no payment waiting for you in this match.");
  let payment = await db.payment.findUnique({ where: { registrationId: reg.id } });
  if (!payment || payment.expiresAt <= now)
    throw new AppError(
      "CONFLICT",
      "The payment window has expired. Register again if slots are left.",
    );
  if (payment.status === "PAID") throw new AppError("CONFLICT", "This entry is already paid.");
  if (payment.status === "FAILED") {
    payment = await db.payment.update({
      where: { id: payment.id },
      data: { status: "CREATED", orderId: newOrderId(), sessionId: null },
    });
  }
  const gateway = getPaymentGateway();
  if (!payment.sessionId) {
    // Cashfree needs the payer's mobile number; Google sign-ups may not have one (DECISIONS M31).
    if (gateway.requiresPhone && !reg.user.phone) {
      throw new AppError("PROFILE_INCOMPLETE", PHONE_FOR_MONEY_MESSAGE, { missing: [PHONE_ITEM] });
    }
    const site = siteUrlServer();
    const { paymentSessionId } = await gateway.createOrder({
      orderId: payment.orderId,
      amountPaise: payment.amountPaise,
      customerId: me.id,
      customerPhone: reg.user.phone,
      returnUrl: `${site}/payments/return?order_id={order_id}`,
      notifyUrl: `${site}/api/webhooks/cashfree`,
      expiresAt: addMinutes(payment.expiresAt, 5),
    });
    // Two tabs at once: only the first order is kept, so a payment on it is never orphaned.
    const { count } = await db.payment.updateMany({
      where: { id: payment.id, sessionId: null },
      data: { sessionId: paymentSessionId },
    });
    payment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (!count && !payment.sessionId) throw new AppError("CONFLICT", "Please try again.");
  }
  return {
    orderId: payment.orderId,
    paymentSessionId: payment.sessionId!,
    expiresAt: payment.expiresAt.toISOString(),
    // What Razorpay's popup shows. The amount is fixed by the order; the popup can't change it.
    razorpay:
      gateway instanceof RazorpayPaymentGateway
        ? {
            keyId: gateway.keyId,
            orderId: payment.sessionId!,
            amountPaise: payment.amountPaise,
            name: SITE_NAME,
            description: `Entry fee: ${reg.match.title}`.slice(0, 250),
            prefill: { name: reg.user.displayName ?? "", email: reg.user.email ?? "" },
          }
        : null,
  };
}

const razorpayConfirmSchema = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/**
 * Razorpay's popup calls back with { order, payment, signature }. We verify the signature with our
 * key secret, then re-read the payment from Razorpay and check it belongs to this order, is for the
 * exact amount on our Payment row and is captured (capturing it if only authorized). Only then does
 * the slot confirm, through the same idempotent path as the webhook (DECISIONS M43).
 */
export async function confirmRazorpayPayment(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const v = parseInput(razorpayConfirmSchema, input);
  const gateway = getRazorpayGateway();
  if (!gateway) throw new AppError("UNAVAILABLE", "Payments are not configured.");
  const payment = await db.payment.findFirst({ where: { sessionId: v.razorpay_order_id } });
  if (!payment || payment.userId !== me.id) throw new AppError("NOT_FOUND", "Order not found.");
  const unverified = new AppError(
    "VALIDATION",
    "We couldn't verify this payment. If money was taken, it will be confirmed or refunded automatically.",
  );
  if (
    !verifyRazorpayCheckoutSignature(
      gateway.keySecret,
      v.razorpay_order_id,
      v.razorpay_payment_id,
      v.razorpay_signature,
    )
  ) {
    throw unverified;
  }
  const result = await settleRazorpayPayment(gateway, payment, v.razorpay_payment_id, "checkout");
  if (result === "MISMATCH") throw unverified;
  return { orderId: payment.orderId, result };
}

/**
 * Re-read a Razorpay payment and apply it to our Payment row if it really is this order's money:
 * same order, same amount in INR. An authorized payment is captured first. Shared by the checkout
 * callback and the webhook. Returns "MISMATCH" for anything that doesn't add up.
 */
export async function settleRazorpayPayment(
  gateway: RazorpayPaymentGateway,
  payment: { orderId: string; sessionId: string | null; amountPaise: number },
  razorpayPaymentId: string,
  source: "checkout" | "webhook" | "recovery",
): Promise<PaymentOutcome | "MISMATCH" | "PENDING"> {
  let p = await gateway.fetchPayment(razorpayPaymentId);
  if (
    p.order_id !== payment.sessionId ||
    p.amount !== payment.amountPaise ||
    p.currency !== "INR"
  ) {
    console.error("Razorpay payment does not match the order", payment.orderId, razorpayPaymentId);
    return "MISMATCH";
  }
  if (p.status === "authorized") p = await gateway.capture(p.id, payment.amountPaise);
  if (p.status !== "captured") return "PENDING";
  return applyPaymentEvent(
    payment.orderId,
    "SUCCESS",
    { source: `razorpay-${source}`, payment: p },
    p.id,
  );
}

async function lockMatchRow(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
  return tx.match.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      maxSlots: true,
      startsAt: true,
      registrationClosesAt: true,
      entryFeePaise: true,
      isEntryList: true,
      tournamentId: true,
      bracketRound: true,
      parentMatchId: true,
    },
  });
}

async function slotsTaken(tx: Tx, matchId: string) {
  return tx.registration.count({
    where: { matchId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
  });
}

/** Mark a paid payment for refund (inside a transaction); execute with `executeRefunds` after commit. */
export async function markRefund(tx: Tx, paymentId: string, reason: string) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status !== "PAID") return null;
  return tx.payment.update({
    where: { id: paymentId },
    data: { status: "REFUND_PENDING", refundId: `rf_${p.id}`, refundReason: reason },
  });
}

/** Call the gateway for payments already marked REFUND_PENDING. Safe to call twice (idempotent refund id). */
export async function executeRefunds(
  payments: {
    id: string;
    orderId: string;
    sessionId: string | null;
    cfPaymentId: string | null;
    refundId: string | null;
    amountPaise: number;
    refundReason: string | null;
  }[],
) {
  const gateway = getPaymentGateway();
  for (const p of payments) {
    if (!p.refundId) continue;
    try {
      const { status } = await gateway.refund({
        orderId: p.orderId,
        sessionId: p.sessionId,
        providerPaymentId: p.cfPaymentId,
        refundId: p.refundId,
        amountPaise: p.amountPaise,
        note: p.refundReason ?? "Refund",
      });
      if (status === "SUCCESS") await applyRefundEvent(p.refundId, "SUCCESS", { immediate: true });
    } catch (e) {
      // Stays REFUND_PENDING; the nightly reconciliation retries and flags it.
      console.error("Refund request failed", p.id, e);
    }
  }
}

export type PaymentOutcome =
  "CONFIRMED" | "WAITLISTED_REFUNDED" | "REFUNDED" | "FAILED" | "IGNORED";

/**
 * Apply a verified payment webhook. Idempotent: replays find the payment already moved and do nothing.
 * Success confirms the registration; if its slot was lost meanwhile (expired / match cancelled),
 * the player is waitlisted (or left cancelled) and the money is refunded automatically.
 */
export async function applyPaymentEvent(
  orderId: string,
  event: PaymentEvent,
  raw: unknown,
  cfPaymentId?: string | null,
): Promise<PaymentOutcome> {
  const events: NotificationEvent[] = [];
  let toRefund: Awaited<ReturnType<typeof markRefund>> = null;
  const outcome = await db.$transaction(async (tx): Promise<PaymentOutcome> => {
    const found = await tx.payment.findUnique({ where: { orderId } });
    if (!found) throw new AppError("NOT_FOUND", "Unknown order");
    const match = await lockMatchRow(tx, found.matchId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    const next = nextPaymentStatus(payment.status, event);
    if (!next) return "IGNORED";
    const now = new Date();
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: next,
        rawWebhook: raw as Prisma.InputJsonValue,
        ...(next === "PAID" ? { paidAt: now, cfPaymentId: cfPaymentId ?? null } : {}),
      },
    });
    await writeAudit(tx, {
      actorId: null,
      action: `payment.${next.toLowerCase()}`,
      entityType: "Payment",
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: next, orderId },
    });
    if (next === "FAILED") return "FAILED";

    const reg = await tx.registration.findUniqueOrThrow({ where: { id: payment.registrationId } });
    const signUpClosed =
      match.isEntryList &&
      (match.status !== "REGISTRATION_OPEN" || now >= match.registrationClosesAt);
    if (reg.status === "PENDING_PAYMENT" && !signUpClosed) {
      await tx.registration.update({ where: { id: reg.id }, data: { status: "CONFIRMED" } });
      events.push({ type: "REGISTRATION_CONFIRMED", userIds: [reg.userId], matchId: match.id });
      return "CONFIRMED";
    }
    if (reg.status === "CONFIRMED") {
      // Paid after using a referral free slot (M52): the real payment wins, the free slot comes back.
      await tx.referralCreditUse.deleteMany({ where: { registrationId: reg.id } });
      return "CONFIRMED";
    }
    const open =
      ["REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(match.status) && match.startsAt > now;
    // Open-entry scrims have room while registration is open (lobbies are split at close).
    const hasRoom = takesEveryone(match)
      ? match.status === "REGISTRATION_OPEN"
      : (await slotsTaken(tx, match.id)) < match.maxSlots;
    if (open && hasRoom) {
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "CONFIRMED", cancelledAt: null },
      });
      events.push({ type: "REGISTRATION_CONFIRMED", userIds: [reg.userId], matchId: match.id });
      return "CONFIRMED";
    }
    // Paid too late: no slot any more. Keep them on the waitlist (if the match still runs) and refund.
    if (open && !takesEveryone(match))
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "WAITLISTED", cancelledAt: null },
      });
    toRefund = await markRefund(tx, payment.id, "No slot available when payment completed");
    return open && !takesEveryone(match) ? "WAITLISTED_REFUNDED" : "REFUNDED";
  });
  if (toRefund) await executeRefunds([toRefund]);
  await Promise.all(events.map(notify));
  return outcome;
}

/**
 * Jobs: did the provider take money for this order although no webhook reached us? Razorpay payments
 * are settled with their payment id (needed for refunds); Cashfree by order status. True if applied.
 */
export async function recoverPaidOrder(p: {
  orderId: string;
  sessionId: string | null;
  amountPaise: number;
}): Promise<boolean> {
  const gateway = getPaymentGateway();
  if (gateway instanceof RazorpayPaymentGateway) {
    if (!p.sessionId) return false;
    const paymentId = await gateway.findOrderPayment(p.sessionId);
    if (!paymentId) return false;
    const r = await settleRazorpayPayment(gateway, p, paymentId, "recovery");
    return r !== "MISMATCH" && r !== "PENDING";
  }
  if ((await gateway.fetchOrderStatus(p)) !== "PAID") return false;
  await applyPaymentEvent(p.orderId, "SUCCESS", { source: "recovery" });
  return true;
}

/** Apply a verified refund webhook (REFUND_PENDING -> REFUNDED). Idempotent. */
export async function applyRefundEvent(
  refundId: string,
  event: RefundEvent,
  opts: { raw?: unknown; immediate?: boolean } = {},
) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { refundId } });
    if (!payment) throw new AppError("NOT_FOUND", "Unknown refund");
    const next = nextRefundStatus(payment.status, event);
    if (!next) return "IGNORED" as const;
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: next, refundedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: null,
      action: "payment.refunded",
      entityType: "Payment",
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: next, refundId, via: opts.immediate ? "api" : "webhook" },
    });
    return "REFUNDED" as const;
  });
}

/** Owner-only status for the post-checkout page (never trusts the redirect; reads our DB). */
export async function getMyOrderStatus(actor: Actor | null, orderId: string) {
  const me = assertUser(actor);
  const payment = await db.payment.findUnique({
    where: { orderId },
    select: { userId: true, status: true, matchId: true, expiresAt: true },
  });
  if (!payment || payment.userId !== me.id) throw new AppError("NOT_FOUND", "Order not found.");
  const reg = await db.registration.findFirst({
    where: { matchId: payment.matchId, userId: me.id },
    select: { status: true },
  });
  return {
    status: payment.status,
    registrationStatus: reg?.status ?? null,
    matchId: payment.matchId,
  };
}
