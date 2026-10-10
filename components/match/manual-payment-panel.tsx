"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, ClockIcon, ImagePlusIcon } from "lucide-react";
import { submitManualPaymentAction } from "@/app/(site)/scrims/[id]/actions";
import { useCountdown } from "@/components/auth/use-countdown";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UPI_APP_LABEL, UPI_APPS, type UpiAppId } from "@/lib/manual-payments";
import { formatINR } from "@/lib/money";
import { chipClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Pay the admin's UPI QR, then upload proof (DECISIONS M54): the app used, the transaction ID and a
 * screenshot. The slot is confirmed when an admin approves it.
 */
export function ManualPaymentPanel({
  matchId,
  amountPaise,
  expiresAt,
  qrUrl,
  status,
  rejectReason,
}: {
  matchId: string;
  amountPaise: number;
  expiresAt: string;
  qrUrl: string | null;
  status: "AWAITING_PROOF" | "SUBMITTED" | "APPROVED" | "REJECTED" | "EXPIRED";
  rejectReason: string | null;
}) {
  const router = useRouter();
  const [app, setApp] = useState<UpiAppId | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const left = useCountdown(Date.parse(expiresAt));
  const submit = useAction(submitManualPaymentAction);

  if (status === "SUBMITTED") {
    return (
      <div className="card-ds border-gold/60 space-y-1 p-3 text-sm" role="status">
        <p className="text-gold flex items-center gap-2 font-semibold">
          <ClockIcon aria-hidden className="size-4" />
          Payment pending approval
        </p>
        <p className="text-muted-foreground">
          We got your payment proof. Your slot is held, and you&apos;ll get a &quot;Slot
          confirmed&quot; message as soon as an admin checks it.
        </p>
      </div>
    );
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="space-y-3">
      {status === "REJECTED" && rejectReason ? (
        <p className="bg-destructive/15 text-destructive rounded-lg p-3 text-sm" role="alert">
          Payment not approved: {rejectReason}. Upload the correct payment below.
        </p>
      ) : null}
      <div className="card-ds space-y-2 p-3 text-center">
        <p className="text-sm">
          Scan and pay exactly{" "}
          <strong className="text-gold text-lg">{formatINR(amountPaise)}</strong>
        </p>
        {qrUrl ? (
          // The admin's UPI QR (any UPI app can scan it).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrUrl}
            alt={`UPI QR code to pay ${formatINR(amountPaise)}`}
            width={240}
            height={240}
            className="mx-auto rounded-lg bg-white p-2"
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            The payment QR is being updated. Check back soon.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Upload your payment within{" "}
          <span className="text-foreground font-semibold">
            {mm}:{ss}
          </span>{" "}
          or the slot is released.
        </p>
      </div>

      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("matchId", matchId);
          if (app) form.set("app", app);
          const r = await submit.run(form);
          if (r.ok) router.refresh();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Paid with</legend>
          <div className="flex flex-wrap gap-2">
            {UPI_APPS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={app === a}
                className={chipClass(app === a)}
                onClick={() => setApp(a)}
              >
                {UPI_APP_LABEL[a]}
              </button>
            ))}
          </div>
          <FieldError id="mp-app-error" messages={submit.fieldErrors.app} />
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="mp-txn">Transaction ID / UPI reference (UTR)</Label>
          <Input
            id="mp-txn"
            name="transactionId"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            autoComplete="off"
            inputMode="text"
            placeholder="e.g. 412345678901"
            aria-invalid={!!submit.fieldErrors.transactionId || undefined}
            aria-describedby="mp-txn-help mp-txn-error"
          />
          <p id="mp-txn-help" className="text-muted-foreground text-xs">
            Find it in your UPI app under the payment details (12-digit UTR or transaction ID).
          </p>
          <FieldError id="mp-txn-error" messages={submit.fieldErrors.transactionId} />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="mp-shot"
            className={cn(
              buttonVariants({ variant: "gold-outline" }),
              "w-full cursor-pointer focus-within:ring-2",
            )}
          >
            <ImagePlusIcon aria-hidden className="size-4" />
            {fileName ? "Change screenshot" : "Upload payment screenshot"}
            <input
              id="mp-shot"
              name="screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {fileName ?? "A screenshot of the successful payment (PNG or JPEG, up to 5 MB)."}
          </p>
          <FieldError id="mp-shot-error" messages={submit.fieldErrors.screenshot} />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={submit.pending || !app || !transactionId.trim() || !fileName || left === 0}
        >
          <CheckCircle2Icon aria-hidden className="size-4" />
          {submit.pending ? "Sending…" : "Submit payment for approval"}
        </Button>
      </form>
    </div>
  );
}
