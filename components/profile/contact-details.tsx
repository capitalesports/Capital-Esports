"use client";

import { useState } from "react";
import { BadgeCheckIcon, EyeIcon, EyeOffIcon, MailIcon, PhoneIcon } from "lucide-react";
import {
  confirmEmailVerificationAction,
  removeEmailAction,
  requestEmailVerificationAction,
  setEmailOptInAction,
} from "@/app/(site)/profile/actions";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPhone, maskEmail, maskPhone } from "@/lib/contact-display";
import { normalizeEmail } from "@/lib/input-rules";
import { phoneLoginEnabled } from "@/lib/phone-login";
import { ChangePhoneForm } from "./change-phone-form";

function VerifiedBadge() {
  return (
    <span className="text-success inline-flex items-center gap-1 text-xs font-medium">
      <BadgeCheckIcon aria-hidden className="size-4" /> Verified
    </span>
  );
}

/** The value, masked until the player taps the eye (their own screen may be seen or shared). */
export function Revealable({
  shown,
  masked,
  what,
}: {
  shown: string;
  masked: string;
  what: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium break-all">{visible ? shown : masked}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-pressed={visible}
        aria-label={visible ? `Hide ${what}` : `Show ${what}`}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
    </span>
  );
}

function Row({
  icon,
  label,
  children,
  actions,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3 last:border-b-0 last:pb-0">
      <span className="text-gold" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">{label}</p>
        <div className="flex flex-wrap items-center gap-x-3">{children}</div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Login and contact details: the verified phone (login) and email, masked with a show/hide
 * toggle, plus changing the phone, adding/changing/removing the email and email notifications.
 */
export function ContactDetails({
  phone,
  email,
  emailOptIn,
}: {
  /** Null for an account made with Google (DECISIONS M31). */
  phone: string | null;
  email: string | null;
  emailOptIn: boolean;
}) {
  const [editing, setEditing] = useState<"phone" | "email" | null>(null);
  const [draft, setDraft] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useAction(requestEmailVerificationAction);
  const confirm = useAction(confirmEmailVerificationAction);
  const remove = useAction(removeEmailAction);
  const toggle = useAction(setEmailOptInAction);

  function closeEmail() {
    setEditing(null);
    setSentTo(null);
    setDraft("");
    setCode("");
    setError(null);
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeEmail(draft);
    if (!normalized) return setError("Enter a valid email address.");
    if (normalized === email) return setError("That is already your email.");
    const r = await request.run({ email: normalized });
    if (r.ok) {
      setSentTo(r.data);
      setCode("");
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code.");
    const r = await confirm.run({ code });
    if (r.ok) closeEmail();
  }

  return (
    <div className="space-y-3">
      {phoneLoginEnabled() ? (
        <>
          <Row
            icon={<PhoneIcon className="size-5" />}
            label={phone ? "Phone (used to log in)" : "Phone (optional)"}
            actions={
              editing === "phone" ? null : (
                <Button type="button" variant="outline" onClick={() => setEditing("phone")}>
                  {phone ? "Change" : "Add"}
                </Button>
              )
            }
          >
            {phone ? (
              <>
                <Revealable
                  shown={formatPhone(phone)}
                  masked={maskPhone(phone)}
                  what="phone number"
                />
                <VerifiedBadge />
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Not added. You only need it to pay entry fees for paid matches.
              </p>
            )}
          </Row>
          {editing === "phone" ? (
            <div className="bg-background/40 space-y-3 rounded-lg p-3">
              <ChangePhoneForm current={phone} />
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <Row
        icon={<MailIcon className="size-5" />}
        label="Email (required: match updates are sent here)"
        actions={
          editing === "email" ? null : email ? (
            <>
              <Button type="button" variant="outline" onClick={() => setEditing("email")}>
                Change
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={remove.pending}
                onClick={() => void remove.run()}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button type="button" variant="gold-outline" onClick={() => setEditing("email")}>
              Add email
            </Button>
          )
        }
      >
        {email ? (
          <>
            <Revealable shown={email} masked={maskEmail(email)} what="email" />
            <VerifiedBadge />
          </>
        ) : (
          <span className="text-destructive text-sm font-medium">
            Required: add and verify your email to register for matches
          </span>
        )}
      </Row>

      {editing === "email" ? (
        <div className="bg-background/40 space-y-3 rounded-lg p-3">
          {sentTo ? (
            <form onSubmit={verify} className="space-y-3" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email-code">Code sent to {sentTo}</Label>
                <Input
                  id="email-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-describedby="email-error"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={confirm.pending}>
                  {confirm.pending ? "Verifying…" : "Verify email"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setSentTo(null)}>
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={sendCode} className="space-y-3" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email-new">{email ? "New email" : "Email"}</Label>
                <Input
                  id="email-new"
                  type="email"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-describedby="email-error"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={request.pending}>
                  {request.pending ? "Sending…" : "Send code"}
                </Button>
                <Button type="button" variant="ghost" onClick={closeEmail}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <FieldError id="email-error" messages={error ? [error] : undefined} />
        </div>
      ) : null}

      {email ? (
        <div className="min-h-tap flex items-center justify-between gap-4 pt-1">
          <Label htmlFor="email-optin" className="font-normal">
            Email me about slots, room IDs, results and prizes
          </Label>
          <Switch
            id="email-optin"
            checked={emailOptIn}
            disabled={toggle.pending}
            onCheckedChange={(checked) => void toggle.run({ optIn: checked })}
          />
        </div>
      ) : null}
    </div>
  );
}
