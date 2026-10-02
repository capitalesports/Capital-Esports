"use server";

import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/guards";
import { createReport } from "@/server/services/reports";

/** Report a player or a result, or open a dispute. Used on player and match pages. */
export async function createReportAction(input: {
  type: "PLAYER" | "RESULT" | "DISPUTE";
  targetUserId?: string;
  matchId?: string;
  reason: string;
  evidenceUrl?: string;
}) {
  return runAction(
    async () => {
      await createReport(await requireUser(), input);
    },
    input.type === "DISPUTE"
      ? "Dispute opened. A moderator will review it."
      : "Report sent. Thank you.",
  );
}
