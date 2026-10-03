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
  return marked;
}

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
