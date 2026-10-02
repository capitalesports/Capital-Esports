import "server-only";
import { writeAudit } from "@/server/audit";
import type { Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { canTransition, STATUS_LABEL, type MatchStatus } from "@/lib/match-state";
import { cancelIncompleteRegistrations } from "./registration";

export interface TransitionContext {
  actorId: string | null;
  /** Extra columns to set alongside the status (e.g. cancelReason). */
  data?: { cancelReason?: string; resultsApprovedAt?: Date | null };
  action?: string;
}

/**
 * Move a match from `from` to `to` inside a transaction.
 * The update is conditional on the current status, so concurrent callers (cron + admin)
 * cannot apply the same transition twice. Throws CONFLICT if the status already changed.
 */
export async function applyTransition(
  tx: Tx,
  matchId: string,
  from: MatchStatus,
  to: MatchStatus,
  ctx: TransitionContext,
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new AppError(
      "CONFLICT",
      `Cannot move a match from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[to]}".`,
    );
  }
  const { count } = await tx.match.updateMany({
    where: { id: matchId, status: from },
    data: { status: to, ...ctx.data },
  });
  if (count === 0) {
    throw new AppError(
      "CONFLICT",
      "The match status changed in the meantime. Refresh and try again.",
    );
  }
  // Squads that never fully confirmed lose their registration when registration closes.
  const droppedSquads =
    to === "REGISTRATION_CLOSED" ? await cancelIncompleteRegistrations(tx, matchId) : 0;
  await writeAudit(tx, {
    actorId: ctx.actorId,
    action: ctx.action ?? (ctx.actorId ? "match.status" : "match.status.auto"),
    entityType: "Match",
    entityId: matchId,
    before: { status: from },
    after: { status: to, ...ctx.data, ...(droppedSquads ? { droppedSquads } : {}) },
  });
}
