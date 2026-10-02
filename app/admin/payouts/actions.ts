"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import {
  addSeasonPrize,
  approvePayout,
  markPayoutPaidManually,
  resolveReconciliationFlag,
  revealPayoutUpi,
  setPayoutProgress,
  syncTournamentPayouts,
  voidPayout,
} from "@/server/services/payouts";

export async function syncPayoutsAction() {
  return runAction(async () => {
    const counts = await syncTournamentPayouts(await requireAdmin());
    revalidatePath("/admin/payouts");
    return counts;
  }, "Ledger updated from published winners");
}

export async function addSeasonPrizeAction(input: {
  seasonId: string;
  place: string;
  amount: string;
}) {
  return runAction(async () => {
    await addSeasonPrize(await requireAdmin(), input);
    revalidatePath("/admin/payouts");
  }, "Season prize added");
}

export async function approvePayoutAction(input: { payoutId: string }) {
  return runAction(async () => {
    const outcome = await approvePayout(await requireAdmin(), input);
    revalidatePath("/admin/payouts");
    return outcome;
  });
}

export async function markPayoutPaidAction(input: { payoutId: string; reference: string }) {
  return runAction(async () => {
    await markPayoutPaidManually(await requireAdmin(), input);
    revalidatePath("/admin/payouts");
  }, "Confirmed as paid");
}

export async function revealPayoutUpiAction(input: { payoutId: string }) {
  return runAction(async () => revealPayoutUpi(await requireAdmin(), input));
}

export async function setPayoutProgressAction(input: {
  payoutId: string;
  status: "PENDING" | "PROCESSING";
}) {
  return runAction(
    async () => {
      await setPayoutProgress(await requireAdmin(), input);
      revalidatePath("/admin/payouts");
    },
    input.status === "PROCESSING" ? "Marked as processing" : "Marked as waiting",
  );
}

export async function voidPayoutAction(input: { payoutId: string; reason: string }) {
  return runAction(async () => {
    await voidPayout(await requireAdmin(), input);
    revalidatePath("/admin/payouts");
  }, "Payout voided");
}

export async function resolveFlagAction(input: { flagId: string }) {
  return runAction(async () => {
    await resolveReconciliationFlag(await requireAdmin(), input);
    revalidatePath("/admin/payouts");
  }, "Flag resolved");
}
