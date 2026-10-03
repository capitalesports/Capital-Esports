import "server-only";
import { db } from "@/server/db";
import { getPaymentGateway } from "@/server/providers/payment-gateway";
import { getPayoutGateway } from "@/server/providers/payout-gateway";
import { mapTransferStatus } from "@/lib/payments";
import { applyRefundEvent, executeRefunds, recoverPaidOrder } from "@/server/services/payments";
import { applyTransferEvent } from "@/server/services/payouts";
import { lockMatch, promoteWaitlist } from "@/server/services/registration";

/**
 * Every 10 minutes: unpaid registrations past their 10-minute window lose the slot (next waitlisted
 * player is promoted). Before expiring, the order is re-checked with Cashfree so a paid-but-delayed
 * webhook is never lost.
 */
export async function runPaymentExpiryJob(now = new Date()) {
  const due = await db.payment.findMany({
    where: { status: { in: ["CREATED", "FAILED"] }, expiresAt: { lte: now } },
    include: { match: { select: { id: true } } },
    take: 200,
  });
  let expired = 0;
  let recovered = 0;
  for (const p of due) {
    const reg = await db.registration.findUnique({ where: { id: p.registrationId } });
    if (!reg || reg.status !== "PENDING_PAYMENT") continue;
    try {
      if (await recoverPaidOrder(p)) {
        recovered++;
        continue;
      }
    } catch {
      // Provider unreachable: expire anyway; a late success webhook refunds or re-confirms.
    }
    const didExpire = await db.$transaction(async (tx) => {
      const match = await lockMatch(tx, p.matchId);
      const current = await tx.registration.findUniqueOrThrow({ where: { id: reg.id } });
      if (current.status !== "PENDING_PAYMENT") return false;
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
      await tx.payment.updateMany({
        where: { id: p.id, status: "CREATED" },
        data: { status: "FAILED" },
      });
      await promoteWaitlist(tx, match);
      return true;
    });
    if (didExpire) expired++;
  }
  return { expired, recovered };
}

/**
 * Nightly: compare open payments, refunds and transfers with Cashfree. Mismatches are flagged
 * (ReconciliationFlag) and the provider's final state is applied through the normal idempotent paths.
 */
export async function runReconciliationJob(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400_000);
  const pg = getPaymentGateway();
  const flags: { kind: string; entityId: string; ours: string; theirs: string }[] = [];

  const open = await db.payment.findMany({
    where: { status: "CREATED", createdAt: { gte: since }, sessionId: { not: null } },
  });
  for (const p of open) {
    if (await recoverPaidOrder(p).catch(() => false)) {
      flags.push({ kind: "payment", entityId: p.id, ours: p.status, theirs: "PAID" });
    }
  }

  const refunds = await db.payment.findMany({
    where: { status: "REFUND_PENDING", refundId: { not: null } },
  });
  for (const p of refunds) {
    const theirs = await pg
      .fetchRefundStatus({ ...p, providerPaymentId: p.cfPaymentId, refundId: p.refundId! })
      .catch(() => "NOT_FOUND");
    if (theirs === "SUCCESS") {
      flags.push({ kind: "refund", entityId: p.id, ours: p.status, theirs });
      await applyRefundEvent(p.refundId!, "SUCCESS", { raw: { source: "reconciliation" } });
    } else if (theirs === "NOT_FOUND" || theirs === "CANCELLED") {
      flags.push({ kind: "refund", entityId: p.id, ours: p.status, theirs });
      await executeRefunds([p]); // (re)request the refund; same refund id keeps it idempotent
    }
  }

  const transfers = await db.payout.findMany({
    where: { status: "PROCESSING", transferId: { not: null } },
  });
  const po = getPayoutGateway();
  for (const t of transfers) {
    const theirs = await po.getTransferStatus(t.transferId!).catch(() => "UNREACHABLE");
    const mapped = mapTransferStatus(theirs);
    if (mapped && mapped !== "PROCESSING") {
      flags.push({ kind: "payout", entityId: t.id, ours: t.status, theirs });
      await applyTransferEvent(t.transferId!, `TRANSFER_${mapped}`, {
        source: "reconciliation",
        status: theirs,
      });
    }
  }

  if (flags.length) await db.reconciliationFlag.createMany({ data: flags });
  return { checked: open.length + refunds.length + transfers.length, flagged: flags.length };
}
