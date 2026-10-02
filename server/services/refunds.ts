import "server-only";
import type { Tx } from "@/server/db";
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
