"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import { savePointsConfig } from "@/server/services/points-config";

export async function savePointsConfigAction(input: {
  game: string;
  placementPoints: string;
  killPoints: string;
  winPoints: string;
  lossPoints: string;
  tournamentMultiplier: string;
}) {
  return runAction(async () => {
    await savePointsConfig(await requireAdmin(), input);
    revalidatePath("/admin/points");
  }, "Points saved");
}
