"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireModerator } from "@/server/auth/guards";
import { resolveReport } from "@/server/services/reports";

export async function resolveReportAction(input: {
  reportId: string;
  status: "RESOLVED" | "DISMISSED";
  resolution: string;
}) {
  return runAction(async () => {
    await resolveReport(await requireModerator(), input);
    revalidatePath("/admin/reports");
  }, "Report closed");
}
