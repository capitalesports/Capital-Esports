"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import { AppError } from "@/server/errors";
import {
  approveManualPayment,
  rejectManualPayment,
  setPaymentQr,
} from "@/server/services/manual-payments";

function refresh() {
  revalidatePath("/admin/payments");
  revalidatePath("/dashboard");
  revalidatePath("/scrims", "layout");
  revalidatePath("/tournament", "layout");
}

export async function approveManualPaymentAction(input: { manualPaymentId: string }) {
  return runAction(async () => {
    await approveManualPayment(await requireAdmin(), input);
    refresh();
  }, "Payment approved. The player's slot is confirmed.");
}

export async function rejectManualPaymentAction(input: {
  manualPaymentId: string;
  reason: string;
  release: boolean;
}) {
  return runAction(async () => {
    await rejectManualPayment(await requireAdmin(), input);
    refresh();
  }, "Payment rejected. The player was told why.");
}

/** Upload (or remove) the UPI QR for a match or a tournament's sign-up (DECISIONS M54). */
export async function setPaymentQrAction(form: FormData) {
  return runAction(async () => {
    const actor = await requireAdmin();
    const file = form.get("qr");
    if (file !== null && !(file instanceof File))
      throw new AppError("VALIDATION", "Invalid image.");
    const bytes = file && file.size ? new Uint8Array(await file.arrayBuffer()) : null;
    const matchId = String(form.get("matchId") ?? "") || undefined;
    const tournamentId = String(form.get("tournamentId") ?? "") || undefined;
    const r = await setPaymentQr(
      actor,
      { matchId, tournamentId, remove: form.get("remove") === "true" },
      bytes,
    );
    revalidatePath(`/admin/matches/${r.matchId}`);
    if (tournamentId) revalidatePath(`/admin/tournaments/${tournamentId}`);
    refresh();
    return r.paymentQrUrl;
  }, "Payment QR saved");
}
