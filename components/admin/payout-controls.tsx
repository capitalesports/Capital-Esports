"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  addSeasonPrizeAction,
  approvePayoutAction,
  markPayoutPaidAction,
  resolveFlagAction,
  revealPayoutUpiAction,
  setPayoutProgressAction,
  syncPayoutsAction,
  voidPayoutAction,
} from "@/app/admin/payouts/actions";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SyncLedgerButton() {
  const { run, pending } = useAction(syncPayoutsAction);
  return (
    <Button variant="outline" disabled={pending} onClick={() => run()}>
      Add published tournament prizes
    </Button>
  );
}

export function ApprovePayoutButton({ payoutId, label }: { payoutId: string; label: string }) {
  const { run, pending } = useAction(approvePayoutAction);
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!confirm("Approve this payout?")) return;
        const r = await run({ payoutId });
        if (r.ok)
          toast.success(
            r.data === "SENT"
              ? "Transfer sent"
              : "First approval recorded — a second admin must approve",
          );
      }}
    >
      {label}
    </Button>
  );
}

/**
 * Our side of a hand-paid prize (DECISIONS M26): Waiting → Processing → Confirmed (paid, with the
 * UPI/bank reference), or void it.
 */
export function SettlePayoutControls({
  payoutId,
  winner,
  status,
}: {
  payoutId: string;
  winner: string;
  status: string;
}) {
  const [mode, setMode] = useState<"idle" | "paid" | "void">("idle");
  const [text, setText] = useState("");
  const paid = useAction(markPayoutPaidAction);
  const voided = useAction(voidPayoutAction);
  const progress = useAction(setPayoutProgressAction);
  const current = status === "PROCESSING" ? "PROCESSING" : "PENDING";
  if (mode === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={`Payout status: ${winner}`}
          value={current}
          disabled={progress.pending}
          className="h-9 w-44"
          onChange={(e) => {
            const next = e.target.value;
            if (next === "SUCCESS") setMode("paid");
            else void progress.run({ payoutId, status: next as "PENDING" | "PROCESSING" });
          }}
        >
          <option value="PENDING">Waiting</option>
          <option value="PROCESSING">Processing</option>
          <option value="SUCCESS">Confirmed (paid)</option>
        </NativeSelect>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Void payout: ${winner}`}
          onClick={() => setMode("void")}
        >
          Void payout
        </Button>
      </div>
    );
  }
  const action = mode === "paid" ? paid : voided;
  const id = `settle-${mode}-${payoutId}`;
  const errors = mode === "paid" ? paid.fieldErrors.reference : voided.fieldErrors.reason;
  return (
    <form
      className="flex min-w-56 flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r =
          mode === "paid"
            ? await paid.run({ payoutId, reference: text })
            : await voided.run({ payoutId, reason: text });
        if (r.ok) {
          setMode("idle");
          setText("");
        }
      }}
    >
      <FormField
        id={id}
        label={mode === "paid" ? "UPI / bank reference" : "Reason for voiding"}
        errors={errors}
      >
        <Input id={id} value={text} onChange={(e) => setText(e.target.value)} />
      </FormField>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant={mode === "void" ? "destructive" : "default"}
          disabled={action.pending}
        >
          {mode === "paid" ? "Confirm paid" : "Void"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
          Back
        </Button>
      </div>
    </form>
  );
}

/** Masked UPI with "Show UPI" for paying by hand; the reveal is audited (DECISIONS M32). */
export function RevealUpi({ payoutId, masked }: { payoutId: string; masked: string }) {
  const [shown, setShown] = useState<{ vpa: string; name: string } | null>(null);
  const { run, pending } = useAction(revealPayoutUpiAction);
  if (!shown) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span>{masked}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            const r = await run({ payoutId });
            if (r.ok) setShown(r.data);
          }}
        >
          Show UPI
        </Button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        <span className="font-mono text-sm font-semibold select-all">{shown.vpa}</span>
        <span className="text-muted-foreground block">{shown.name}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(shown.vpa);
            toast.success("UPI ID copied");
          } catch {
            // Clipboard blocked: the UPI ID is selectable on screen.
          }
        }}
      >
        Copy
      </Button>
    </span>
  );
}

export function ResolveFlagButton({ flagId, about }: { flagId: string; about: string }) {
  const { run, pending } = useAction(resolveFlagAction);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Mark resolved: ${about}`}
      onClick={() => run({ flagId })}
    >
      Mark resolved
    </Button>
  );
}

export function SeasonPrizeForm({ seasons }: { seasons: { id: string; label: string }[] }) {
  const [v, setV] = useState({ seasonId: seasons[0]?.id ?? "", place: "1", amount: "" });
  const { run, pending, fieldErrors } = useAction(addSeasonPrizeAction);
  if (!seasons.length)
    return <p className="text-muted-foreground text-sm">No archived seasons yet.</p>;
  return (
    <form
      className="grid gap-3 sm:grid-cols-4 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void run(v);
      }}
    >
      <FormField id="sp-season" label="Season" errors={fieldErrors.seasonId}>
        <NativeSelect
          id="sp-season"
          value={v.seasonId}
          onChange={(e) => setV({ ...v, seasonId: e.target.value })}
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id="sp-place" label="Place" errors={fieldErrors.place}>
        <NativeSelect
          id="sp-place"
          value={v.place}
          onChange={(e) => setV({ ...v, place: e.target.value })}
        >
          <option value="1">1st</option>
          <option value="2">2nd</option>
          <option value="3">3rd</option>
        </NativeSelect>
      </FormField>
      <FormField id="sp-amount" label="Prize (₹)" errors={fieldErrors.amount}>
        <Input
          id="sp-amount"
          inputMode="decimal"
          value={v.amount}
          onChange={(e) => setV({ ...v, amount: e.target.value })}
        />
      </FormField>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add season prize
      </Button>
    </form>
  );
}
