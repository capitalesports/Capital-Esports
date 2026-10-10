"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrCodeIcon } from "lucide-react";
import { setPaymentQrAction } from "@/app/admin/payments/actions";
import { useAction } from "@/components/common/use-action";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * "Collect the entry fee with my UPI QR" (DECISIONS M54): a switch and a QR upload next to the
 * entry fee. Players then pay the QR and upload proof; admins approve in Payment approvals.
 */
export function PaymentQrBox({
  matchId,
  tournamentId,
  entryFeePaise,
  qrUrl,
}: {
  matchId?: string;
  tournamentId?: string;
  entryFeePaise: number;
  qrUrl: string | null;
}) {
  const router = useRouter();
  const save = useAction(setPaymentQrAction);
  const [on, setOn] = useState(!!qrUrl);
  const [fileName, setFileName] = useState<string | null>(null);

  async function send(form: FormData) {
    if (matchId) form.set("matchId", matchId);
    if (tournamentId) form.set("tournamentId", tournamentId);
    const r = await save.run(form);
    if (r.ok) {
      setFileName(null);
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="qr-h" className="card-ds space-y-3 p-4">
      <h2 id="qr-h" className="flex items-center gap-2 font-semibold">
        <QrCodeIcon aria-hidden className="text-gold size-5" />
        Entry fee payment by UPI QR
      </h2>
      {entryFeePaise === 0 ? (
        <p className="text-muted-foreground text-sm">
          This is free to join. Set an entry fee first to collect payments by QR.
        </p>
      ) : (
        <>
          <label className="min-h-tap flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              checked={on}
              onChange={async (e) => {
                setOn(e.target.checked);
                if (!e.target.checked && qrUrl) {
                  const form = new FormData();
                  form.set("remove", "true");
                  await send(form);
                }
              }}
              className="size-4"
            />
            Collect the {formatINR(entryFeePaise)} entry fee with my UPI QR
          </label>
          {on ? (
            <>
              <p className="text-muted-foreground text-xs">
                Make a fixed-amount QR for exactly {formatINR(entryFeePaise)} in your UPI app and
                upload it. Players scan it, then upload their transaction ID and screenshot for you
                to approve in Payment approvals.
              </p>
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrUrl}
                  alt="Current payment QR"
                  width={160}
                  height={160}
                  className="rounded-lg bg-white p-2"
                />
              ) : (
                <p className="text-destructive text-sm">
                  No QR yet: paid registrations stay closed until you upload one.
                </p>
              )}
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await send(new FormData(e.currentTarget));
                }}
              >
                <label
                  htmlFor={`qr-file-${matchId ?? tournamentId}`}
                  className={cn(buttonVariants({ variant: "gold-outline" }), "cursor-pointer")}
                >
                  {qrUrl ? "Choose a new QR" : "Choose QR image"}
                  <input
                    id={`qr-file-${matchId ?? tournamentId}`}
                    name="qr"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                  />
                </label>
                <Button type="submit" disabled={save.pending || !fileName}>
                  {save.pending ? "Uploading…" : "Upload QR"}
                </Button>
                <span className="text-muted-foreground text-xs" aria-live="polite">
                  {fileName ?? ""}
                </span>
              </form>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
