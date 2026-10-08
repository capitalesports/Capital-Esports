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
import { confirmRazorpayPayment, startCheckout } from "@/server/services/payments";
import { redeemReferralCredit } from "@/server/services/referrals";

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

/** Razorpay popup callback: the server verifies the signature and re-reads the payment (M43). */
export async function confirmRazorpayPaymentAction(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) {
  return runAction(async () => confirmRazorpayPayment(await requireUser(), input));
}

/** Spend a referral free slot on my entry that is waiting for payment (DECISIONS M52). */
export async function redeemFreeSlotAction(input: { matchId: string }) {
  return runAction(async () => {
    await redeemReferralCredit(await requireUser(), input);
    refresh(input.matchId);
    revalidatePath("/tournament", "layout");
    revalidatePath("/refer");
  }, "Free slot used. Your slot is confirmed.");
}
