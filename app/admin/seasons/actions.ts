"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import { endSeason, startSeason } from "@/server/services/seasons";

export async function endSeasonAction(input: { seasonId: string }) {
  return runAction(async () => {
    await endSeason(await requireAdmin(), input);
    revalidatePath("/admin/seasons");
    revalidatePath("/leaderboard", "layout");
  }, "Season ended and archived");
}

export async function startSeasonAction(input: { game: string; name: string; startsOn: string }) {
  return runAction(async () => {
    await startSeason(await requireAdmin(), input);
    revalidatePath("/admin/seasons");
    revalidatePath("/leaderboard", "layout");
  }, "Season started");
}
