"use client";

import { useState } from "react";
import { BadgeCheckIcon, LandmarkIcon, WalletIcon } from "lucide-react";
import { savePayoutMethodAction } from "@/app/(site)/profile/actions";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Revealable } from "./contact-details";

export interface SavedPayoutMethod {
  kind: "UPI" | "BANK";
  accountHolderName: string;
  /** Full UPI ID (owner only). Null for methods saved before it was kept: then only the mask shows. */
  vpa: string | null;
  vpaMasked: string | null;
  accountLast4: string | null;
  ifsc: string | null;
}

/** The saved method as a row: masked UPI ID with a show/hide toggle, or the bank account's last digits. */
function SavedMethod({ saved, onChange }: { saved: SavedPayoutMethod; onChange: () => void }) {
  const upi = saved.kind === "UPI";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-gold" aria-hidden>
        {upi ? <WalletIcon className="size-5" /> : <LandmarkIcon className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">
          {upi ? "UPI ID" : "Bank account"} · {saved.accountHolderName}
        </p>
        <div className="flex flex-wrap items-center gap-x-3">
          {upi ? (
            saved.vpa ? (
              <Revealable shown={saved.vpa} masked={saved.vpaMasked ?? ""} what="UPI ID" />
            ) : (
              <span className="font-medium">{saved.vpaMasked}</span>
            )
          ) : (
            <span className="font-medium">
              ••••{saved.accountLast4} · {saved.ifsc}
            </span>
          )}
          <span className="text-success inline-flex items-center gap-1 text-xs font-medium">
            <BadgeCheckIcon aria-hidden className="size-4" /> Saved
          </span>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

export function PayoutMethodForm({
  saved,
  adult,
  minorMessage,
  hasDateOfBirth = true,
}: {
  saved: SavedPayoutMethod | null;
  adult: boolean;
  minorMessage: string;
  /** No date of birth yet: ask for it (it isn't "under 18"). */
  hasDateOfBirth?: boolean;
}) {
  const [editing, setEditing] = useState(!saved);
  const [kind, setKind] = useState<"UPI" | "BANK">(saved?.kind ?? "UPI");
  const [v, setV] = useState({
    accountHolderName: saved?.accountHolderName ?? "",
    vpa: "",
    accountNumber: "",
    ifsc: "",
  });
  const { run, pending, fieldErrors } = useAction(savePayoutMethodAction);

  const blocked = !hasDateOfBirth
    ? "Add your date of birth in Details above first. Then you can add your UPI ID or bank account here."
    : !adult
      ? minorMessage
      : null;
  if (blocked) {
    return (
      <p className="card-ds border-gold/60 bg-gold/10 p-4 text-sm" role="status">
        {blocked}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {saved ? (
        <SavedMethod saved={saved} onChange={() => setEditing(true)} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Add a UPI ID or bank account so tournament prizes can be paid to you.
        </p>
      )}
      {editing ? (
        <form
          className="card-ds space-y-3 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              kind === "UPI"
                ? { kind, accountHolderName: v.accountHolderName, vpa: v.vpa }
                : {
                    kind,
                    accountHolderName: v.accountHolderName,
                    accountNumber: v.accountNumber,
                    ifsc: v.ifsc,
                  },
            );
            if (r.ok) {
              setV((x) => ({ ...x, vpa: "", accountNumber: "", ifsc: "" }));
              setEditing(false);
            }
          }}
        >
          <fieldset className="flex gap-4">
            <legend className="sr-only">Payout method</legend>
            {(["UPI", "BANK"] as const).map((k) => (
              <label key={k} className="min-h-tap flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="payout-kind"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {k === "UPI" ? "UPI" : "Bank account"}
              </label>
            ))}
          </fieldset>
          <FormField id="po-name" label="Account holder name" errors={fieldErrors.accountHolderName}>
            <Input
              id="po-name"
              value={v.accountHolderName}
              onChange={(e) => setV({ ...v, accountHolderName: e.target.value })}
              autoComplete="name"
            />
          </FormField>
          {kind === "UPI" ? (
            <FormField id="po-vpa" label="UPI ID" errors={fieldErrors.vpa}>
              <Input
                id="po-vpa"
                value={v.vpa}
                onChange={(e) => setV({ ...v, vpa: e.target.value })}
                placeholder="name@okaxis"
                autoComplete="off"
              />
            </FormField>
          ) : (
            <>
              <FormField id="po-acc" label="Account number" errors={fieldErrors.accountNumber}>
                <Input
                  id="po-acc"
                  inputMode="numeric"
                  value={v.accountNumber}
                  onChange={(e) => setV({ ...v, accountNumber: e.target.value })}
                  autoComplete="off"
                />
              </FormField>
              <FormField id="po-ifsc" label="IFSC" errors={fieldErrors.ifsc}>
                <Input
                  id="po-ifsc"
                  value={v.ifsc}
                  onChange={(e) => setV({ ...v, ifsc: e.target.value.toUpperCase() })}
                  placeholder="HDFC0001234"
                  autoComplete="off"
                />
              </FormField>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : saved ? "Save new payout method" : "Save payout method"}
            </Button>
            {saved ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
