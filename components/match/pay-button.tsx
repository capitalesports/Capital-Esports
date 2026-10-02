"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startCheckoutAction } from "@/app/(site)/scrims/[id]/actions";
import { useCountdown } from "@/components/auth/use-countdown";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";

export type CheckoutMode = "sandbox" | "production" | "stub";

/** Open Cashfree checkout for a PENDING_PAYMENT registration. Only the webhook confirms the slot. */
export async function openCheckout(
  matchId: string,
  mode: CheckoutMode,
  router: ReturnType<typeof useRouter>,
) {
  const r = await startCheckoutAction({ matchId });
  if (!r.ok) {
    toast.error(r.error);
    return;
  }
  if (mode === "stub") {
    router.push(`/payments/stub/${r.data.orderId}`);
    return;
  }
  const { load } = await import("@cashfreepayments/cashfree-js");
  const cashfree = await load({ mode });
  await cashfree.checkout({ paymentSessionId: r.data.paymentSessionId, redirectTarget: "_self" });
}

export function PayButton({
  matchId,
  amountPaise,
  expiresAt,
  mode,
}: {
  matchId: string;
  amountPaise: number;
  expiresAt: string;
  mode: CheckoutMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const left = useCountdown(new Date(expiresAt).getTime());
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={busy || left === 0}
        onClick={async () => {
          setBusy(true);
          try {
            await openCheckout(matchId, mode, router);
          } finally {
            setBusy(false);
          }
        }}
      >
        Pay {formatINR(amountPaise)} entry fee
      </Button>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {left > 0
          ? `Your slot is held for ${mm}:${ss}. Pay by UPI, card or wallet.`
          : "The payment window has expired."}
      </p>
    </div>
  );
}
