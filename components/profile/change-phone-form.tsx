"use client";

import { useRef, useState } from "react";
import { changePhoneAction } from "@/app/(site)/profile/actions";
import {
  createOtpClient,
  OtpError,
  otpMode,
  STUB_OTP_CODE,
  type OtpClient,
} from "@/components/auth/otp-client";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizePhone } from "@/lib/input-rules";

const RECAPTCHA_ID = "recaptcha-phone-change";

/**
 * Add or change the login phone: verify the number with an OTP, then the server saves it (an
 * account made with Google starts with none, DECISIONS M31).
 */
export function ChangePhoneForm({ current }: { current: string | null }) {
  const clientRef = useRef<OtpClient | null>(null);
  const [number, setNumber] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { run, pending } = useAction(changePhoneAction);

  function client(): OtpClient {
    clientRef.current ??= createOtpClient(RECAPTCHA_ID);
    return clientRef.current;
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizePhone(number);
    if (!normalized) return setError("Enter a valid mobile number.");
    if (normalized === current) return setError("That is already your phone number.");
    setBusy(true);
    try {
      await client().sendCode(normalized);
      setPhone(normalized);
    } catch (err) {
      setError(err instanceof OtpError ? err.message : "Could not send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code.");
    setBusy(true);
    try {
      const idToken = await client().confirmCode(code);
      const result = await run({ idToken });
      if (result.ok) {
        setPhone(null);
        setNumber("");
        setCode("");
      }
    } catch (err) {
      setError(err instanceof OtpError ? err.message : "Verification failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {phone ? (
        <form onSubmit={verify} className="space-y-3" noValidate>
          <div className="space-y-2">
            <Label htmlFor="phone-change-code">Code sent to {phone}</Label>
            <Input
              id="phone-change-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="phone-change-error"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || pending}>
              {busy || pending ? "Verifying…" : "Verify and change"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhone(null)}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={sendCode} className="space-y-3" noValidate>
          <div className="space-y-2">
            <Label htmlFor="phone-change-number">New mobile number</Label>
            <Input
              id="phone-change-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              aria-describedby="phone-change-error"
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        </form>
      )}
      <p id="phone-change-error" role="alert" className="text-destructive text-sm">
        {error}
      </p>
      {otpMode() === "stub" ? (
        <p className="text-muted-foreground text-xs">
          Development mode: use code <strong>{STUB_OTP_CODE}</strong>.
        </p>
      ) : null}
      <div id={RECAPTCHA_ID} />
    </div>
  );
}
