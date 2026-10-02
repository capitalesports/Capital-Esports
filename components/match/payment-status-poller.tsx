"use client";

import { useEffect, useState } from "react";
import { IntentLink as Link } from "@/components/common/intent-link";
import {
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface OrderStatus {
  status: "CREATED" | "PAID" | "FAILED" | "REFUND_PENDING" | "REFUNDED";
  registrationStatus: string | null;
  matchId: string;
}

const POLL_MS = 2000;

type Tone = "pending" | "success" | "refund" | "failed" | "slow";
const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  pending: { icon: LoaderCircleIcon, className: "animate-spin text-gold" },
  success: { icon: CircleCheckIcon, className: "text-success" },
  refund: { icon: RotateCcwIcon, className: "text-gold" },
  failed: { icon: CircleXIcon, className: "text-destructive" },
  slow: { icon: ClockIcon, className: "text-muted-foreground" },
};
const GIVE_UP_AFTER = 45;

export function PaymentStatusPoller({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderStatus | null>(null);
  const [tries, setTries] = useState(0);
  const settled = data && data.status !== "CREATED";

  useEffect(() => {
    if (settled || tries >= GIVE_UP_AFTER) return;
    const id = setTimeout(
      async () => {
        const res = await fetch(`/api/payments/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
        });
        if (res.ok) setData((await res.json()) as OrderStatus);
        setTries((t) => t + 1);
      },
      tries === 0 ? 0 : POLL_MS,
    );
    return () => clearTimeout(id);
  }, [orderId, settled, tries]);

  let message = "Confirming your payment with the bank…";
  let tone: Tone = "pending";
  if (data?.status === "PAID" && data.registrationStatus === "CONFIRMED")
    [message, tone] = ["Payment received. Your slot is confirmed!", "success"];
  else if (data?.status === "PAID") [message, tone] = ["Payment received.", "success"];
  else if (data?.status === "REFUND_PENDING" || data?.status === "REFUNDED")
    [message, tone] = [
      "Payment received, but the match was full by then. You are on the waitlist and the fee is being refunded.",
      "refund",
    ];
  else if (data?.status === "FAILED")
    [message, tone] = [
      "The payment did not go through. You can try again while your slot is held.",
      "failed",
    ];
  else if (tries >= GIVE_UP_AFTER)
    [message, tone] = [
      "Still waiting for confirmation. We will update your dashboard as soon as the bank confirms.",
      "slow",
    ];
  const { icon: Icon, className } = TONE[tone];

  return (
    <div className="mt-6 flex flex-col items-center gap-4 text-center">
      <Icon aria-hidden className={`size-12 ${className}`} />
      <p role="status" aria-live="polite" className="text-lg">
        {message}
      </p>
      {data ? (
        <Button asChild>
          <Link href={`/scrims/${data.matchId}`}>Back to the match</Link>
        </Button>
      ) : null}
    </div>
  );
}
