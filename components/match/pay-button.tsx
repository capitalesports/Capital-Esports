"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmRazorpayPaymentAction,
  startCheckoutAction,
} from "@/app/(site)/scrims/[id]/actions";
import { useCountdown } from "@/components/auth/use-countdown";
import { Button } from "@/components/ui/button";
import { DS } from "@/lib/design-tokens";
import { formatINR } from "@/lib/money";

/** "manual": paid by the admin's UPI QR with proof upload (M54), no online checkout. */
export type CheckoutMode = "sandbox" | "production" | "razorpay" | "stub" | "manual";

const RAZORPAY_CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

/** Load Razorpay's checkout script once (only when a player actually pays). */
function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_JS;
    script.async = true;
    script.onload = () =>
      w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay missing"));
    script.onerror = () => reject(new Error("Could not load Razorpay"));
    document.body.appendChild(script);
  });
}

/**
 * Open checkout for a PENDING_PAYMENT registration. The amount comes from the server's order (the
 * player can't type or change it); the slot is confirmed only after the server verifies the payment.
 */
export async function openCheckout(
  matchId: string,
  mode: CheckoutMode,
  router: ReturnType<typeof useRouter>,
) {
  // Paid by UPI QR (M54): nothing to open; the match page shows the QR and the proof form.
  if (mode === "manual") {
    router.refresh();
    return;
  }
  const r = await startCheckoutAction({ matchId });
  if (!r.ok) {
    toast.error(r.error);
    return;
  }
  if (mode === "stub") {
    router.push(`/payments/stub/${r.data.orderId}`);
    return;
  }
  if (mode === "razorpay") {
    const rzp = r.data.razorpay;
    if (!rzp) {
      toast.error("Payments are not available right now. Please try again later.");
      return;
    }
    const ourOrderId = r.data.orderId;
    let Razorpay: RazorpayCtor;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      toast.error("Could not open the payment window. Check your connection and try again.");
      return;
    }
    new Razorpay({
      key: rzp.keyId,
      order_id: rzp.orderId,
      amount: rzp.amountPaise,
      currency: "INR",
      name: rzp.name,
      description: rzp.description,
      prefill: rzp.prefill,
      theme: { color: DS.gold },
      // UPI first (GPay / PhonePe / Paytm apps on phones, a QR code on computers); cards,
      // netbanking and wallets stay available below it.
      config: {
        display: {
          blocks: {
            upi: { name: "Pay with UPI or QR", instruments: [{ method: "upi" }] },
          },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: true },
        },
      },
      handler: async (response: RazorpayResponse) => {
        const confirmed = await confirmRazorpayPaymentAction(response);
        if (!confirmed.ok) toast.error(confirmed.error);
        // Either way, the status page reads our own record (the webhook may still confirm it).
        router.push(`/payments/return?order_id=${ourOrderId}`);
      },
      modal: { confirm_close: true },
    }).open();
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
