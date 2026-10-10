"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveManualPaymentAction, rejectManualPaymentAction } from "./actions";

/** Approve or reject one manual UPI payment (DECISIONS M54). */
export function ReviewControls({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const approve = useAction(approveManualPaymentAction);
  const reject = useAction(rejectManualPaymentAction);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [release, setRelease] = useState(false);

  if (rejecting) {
    return (
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await reject.run({ manualPaymentId: id, reason, release });
          if (r.ok) router.refresh();
        }}
      >
        <label className="block text-xs font-medium" htmlFor={`reason-${id}`}>
          Reason (the player sees it)
        </label>
        <Input
          id={`reason-${id}`}
          value={reason}
          maxLength={200}
          placeholder="e.g. Amount not received / wrong transaction ID"
          onChange={(e) => setReason(e.target.value)}
        />
        <label className="min-h-tap flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={release}
            onChange={(e) => setRelease(e.target.checked)}
            className="size-4"
          />
          Free the slot now (otherwise the player gets 30 minutes to upload the right payment)
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={reject.pending}>
            Reject
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setRejecting(false)}>
            Back
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        disabled={approve.pending}
        aria-label={`Approve payment: ${label}`}
        onClick={async () => {
          if (!confirm(`Approve this payment (${label})? Check it reached your account first.`))
            return;
          const r = await approve.run({ manualPaymentId: id });
          if (r.ok) router.refresh();
        }}
      >
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Reject payment: ${label}`}
        onClick={() => setRejecting(true)}
      >
        Reject
      </Button>
    </div>
  );
}
