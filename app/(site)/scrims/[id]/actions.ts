"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/guards";
import { AppError } from "@/server/errors";
import {
  cancelRegistration,
  registerForMatch,
  respondToRoster,
} from "@/server/services/registration";
import { submitResult } from "@/server/services/results";
import { startCheckout } from "@/server/services/payments";

function refresh(matchId: string) {
  revalidatePath(`/scrims/${matchId}`);
  revalidatePath("/scrims");
  revalidatePath("/dashboard");
}

export async function registerAction(input: {
  matchId: string;
  teamId?: string;
  memberIds?: string[];
  teamName?: string;
  players?: { gameId: string; ign?: string }[];
}) {
  return runAction(async () => {
    const result = await registerForMatch(await requireUser(), input);
    refresh(input.matchId);
    return result;
  });
}

export async function respondToRosterAction(input: { matchId: string; accept: boolean }) {
  return runAction(
    async () => {
      const result = await respondToRoster(await requireUser(), input);
      refresh(input.matchId);
      return result;
    },
    input.accept ? "Spot confirmed" : "Invitation declined",
  );
}

export async function cancelRegistrationAction(input: { matchId: string }) {
  return runAction(async () => {
    await cancelRegistration(await requireUser(), input);
    refresh(input.matchId);
  }, "Registration cancelled");
}

export async function submitResultAction(form: FormData) {
  return runAction(async () => {
    const actor = await requireUser();
    const matchId = String(form.get("matchId") ?? "");
    const file = form.get("screenshot");
    if (file !== null && !(file instanceof File))
      throw new AppError("VALIDATION", "Invalid screenshot.");
    const bytes = file && file.size ? new Uint8Array(await file.arrayBuffer()) : null;
    const won = form.get("won");
    await submitResult(
      actor,
      {
        matchId,
        placement: form.get("placement") || undefined,
        kills: form.get("kills") || undefined,
        won: won === null ? undefined : won === "true",
        roundDiff: form.get("roundDiff") || undefined,
        trackerUrl: form.get("trackerUrl") || undefined,
      },
      bytes,
    );
    refresh(matchId);
  }, "Result submitted. A moderator will review it.");
}

export async function startCheckoutAction(input: { matchId: string }) {
  return runAction(async () => startCheckout(await requireUser(), input));
}
