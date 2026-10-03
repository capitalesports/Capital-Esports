"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireModerator } from "@/server/auth/guards";
import { AppError } from "@/server/errors";
import { readResultScreenshots } from "@/server/services/result-screenshots";
import { approveResults, reopenResults, saveResultRows } from "@/server/services/results";

function refresh(matchId: string) {
  revalidatePath(`/admin/results/${matchId}`);
  revalidatePath("/admin/results");
  revalidatePath(`/scrims/${matchId}`);
  revalidatePath("/leaderboard", "layout");
}

export async function saveResultRowsAction(input: {
  matchId: string;
  rows: {
    registrationId: string;
    absent?: boolean;
    placement?: number;
    kills?: number;
    won?: boolean;
    roundDiff?: number;
  }[];
}) {
  return runAction(async () => {
    await saveResultRows(await requireModerator(), input);
    refresh(input.matchId);
  }, "Results saved");
}

export async function approveResultsAction(input: { matchId: string }) {
  return runAction(async () => {
    const summary = await approveResults(await requireModerator(), input);
    refresh(input.matchId);
    return summary;
  }, "Results approved and points posted");
}

export async function reopenResultsAction(input: { matchId: string; reason?: string }) {
  return runAction(async () => {
    await reopenResults(await requireModerator(), input);
    refresh(input.matchId);
  }, "Results reopened and points reversed");
}

/** Read end-of-match screenshots with AI and return suggestions for the editor (DECISIONS M48). */
export async function readResultScreenshotsAction(form: FormData) {
  return runAction(async () => {
    const actor = await requireModerator();
    const files = form.getAll("screenshots");
    if (files.some((f) => !(f instanceof File)))
      throw new AppError("VALIDATION", "Invalid screenshot.");
    const images = await Promise.all(
      (files as File[])
        .filter((f) => f.size > 0)
        .map(async (f) => new Uint8Array(await f.arrayBuffer())),
    );
    return readResultScreenshots(actor, { matchId: String(form.get("matchId") ?? "") }, images);
  });
}
