"use client";

import { useState } from "react";
import { markRefundedManuallyAction } from "@/app/admin/payouts/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** "Done by hand": closes a pending entry-fee refund after the admin refunded it (M44). */
export function MarkRefundedButton({ paymentId, about }: { paymentId: string; about: string }) {
  const [note, setNote] = useState("");
  const { run, pending } = useAction(markRefundedManuallyAction);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="Note (optional), e.g. refunded in Razorpay"
        aria-label={`Refund note for ${about}`}
        className="w-56"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              `Mark the refund for ${about} as done? Only do this after the money was sent back.`,
            )
          ) {
            void run({ paymentId, note });
          }
        }}
      >
        Mark refunded
      </Button>
    </div>
  );
}
