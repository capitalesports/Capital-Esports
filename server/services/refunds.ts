import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { assertAdmin, type Actor } from "@/lib/roles";
import { markRefund } from "./payments";

/**
 * Inside the cancel transaction: unpaid attempts fail, every PAID entry is marked REFUND_PENDING.
 * The caller runs `executeRefunds` on the returned payments after commit.
 */
export async function enqueueMatchRefunds(tx: Tx, matchId: string) {
  await tx.payment.updateMany({
    where: { matchId, status: "CREATED" },
    data: { status: "FAILED" },
  });
  const paid = await tx.payment.findMany({
    where: { matchId, status: "PAID" },
    select: { id: true },
  });
  const marked = [];
  for (const p of paid) {
    const m = await markRefund(tx, p.id, "Match cancelled");
    if (m) marked.push(m);
  }
  await queueUnreviewedUpiRefunds(tx, matchId);
  return marked;
}

/**
 * Manual UPI (DECISIONS M54/M62): a player who uploaded proof that wasn't approved yet still paid,
 * so a cancelled match puts them in Refunds too (to check against the UPI app before refunding).
 * Slots still waiting for proof just expire. Refunded by hand, never through the gateway.
 */
async function queueUnreviewedUpiRefunds(tx: Tx, matchId: string) {
  await tx.manualPayment.updateMany({
    where: { matchId, status: "AWAITING_PROOF" },
    data: { status: "EXPIRED" },
  });
  const submitted = await tx.manualPayment.findMany({ where: { matchId, status: "SUBMITTED" } });
  const now = new Date();
  for (const mp of submitted) {
    const data = {
      orderId: `manual_${mp.id}`,
      amountPaise: mp.amountPaise,
      status: "REFUND_PENDING" as const,
      cfPaymentId: mp.transactionId,
      refundId: `rf_manual_${mp.id}`,
      refundReason: `${UNREVIEWED_REFUND}: match cancelled`,
    };
    await tx.payment.upsert({
      where: { registrationId: mp.registrationId },
      create: {
        ...data,
        userId: mp.userId,
        matchId,
        registrationId: mp.registrationId,
        expiresAt: now,
      },
      update: data,
    });
    await tx.manualPayment.update({
      where: { id: mp.id },
      data: { status: "REJECTED", reviewedAt: now, rejectReason: "Match cancelled: refund queued" },
    });
  }
}

/** Refund reason prefix for UPI proof that no admin had checked yet. */
export const UNREVIEWED_REFUND = "Proof not checked";

/** Admin: entry fees waiting to be refunded (oldest first), DECISIONS M44. */
export async function listPendingRefunds(actor: Actor | null) {
  assertAdmin(actor);
  return db.payment.findMany({
    where: { status: "REFUND_PENDING" },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      amountPaise: true,
      refundReason: true,
      updatedAt: true,
      cfPaymentId: true,
      orderId: true,
      user: { select: { id: true, displayName: true, email: true } },
      match: { select: { id: true, title: true } },
    },
  });
}

/**
 * Admin Refunds page (DECISIONS M62): refunds still to make and the latest ones done, with what the
 * admin needs to send the money back by hand (player contact, UPI app and transaction ID).
 */
export async function listRefunds(actor: Actor | null) {
  assertAdmin(actor);
  const select = {
    id: true,
    amountPaise: true,
    status: true,
    refundReason: true,
    refundedAt: true,
    updatedAt: true,
    cfPaymentId: true,
    orderId: true,
    user: { select: { id: true, displayName: true, email: true, phone: true } },
    match: {
      select: {
        id: true,
        title: true,
        game: true,
        tournament: { select: { id: true, title: true } },
      },
    },
  } as const;
  const [pending, done] = await Promise.all([
    db.payment.findMany({
      where: { status: "REFUND_PENDING" },
      orderBy: { updatedAt: "asc" },
      take: 500,
      select,
    }),
    db.payment.findMany({
      where: { status: "REFUNDED" },
      orderBy: { refundedAt: "desc" },
      take: 50,
      select,
    }),
  ]);
  const manualIds = [...pending, ...done]
    .filter((p) => p.orderId.startsWith("manual_"))
    .map((p) => p.orderId.slice("manual_".length));
  const manual = await db.manualPayment.findMany({
    where: { id: { in: manualIds } },
    select: { id: true, app: true },
  });
  const appOf = new Map(manual.map((m) => [`manual_${m.id}`, m.app]));
  const withApp = <T extends { orderId: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, upiApp: appOf.get(r.orderId) ?? null }));
  return { pending: withApp(pending), done: withApp(done) };
}

const manualRefundSchema = z.object({
  paymentId: z.string().min(1).max(50),
  note: z
    .string()
    .trim()
    .max(200, "Use at most 200 characters")
    .optional()
    .transform((v) => v || null),
});

/**
 * Admin: the refund was made by hand (Razorpay dashboard "Issue Refund", or UPI to the player).
 * Closes it so the nightly job stops retrying. Audited with the admin and the note (M44).
 */
export async function markRefundedManually(actor: Actor | null, input: unknown) {
  const admin = assertAdmin(actor);
  const { paymentId, note } = parseInput(manualRefundSchema, input);
  await db.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: "REFUND_PENDING" },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });
    if (!count) throw new AppError("CONFLICT", "This refund is not pending any more.");
    await writeAudit(tx, {
      actorId: admin.id,
      action: "payment.refund.manual",
      entityType: "Payment",
      entityId: paymentId,
      before: { status: "REFUND_PENDING" },
      after: { status: "REFUNDED", note },
    });
  });
}
