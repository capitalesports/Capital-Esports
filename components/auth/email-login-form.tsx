"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeEmail } from "@/lib/input-rules";
import { afterLogin, postJson } from "./auth-post";
import { otpMode } from "./otp-client";
import { useCountdown } from "./use-countdown";

const RESEND_COOLDOWN_MS = 30_000;

/** Log in with a code sent to the account's verified email (also the "forgot password" route). */
export function EmailLoginForm({
  returnTo,
  onBack,
}: {
  returnTo: string | null;
  onBack: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const cooldown = useCountdown(resendAt);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const normalized = normalizeEmail(sentTo ?? email);
    if (!normalized) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await postJson("/api/auth/email/request", { email: normalized });
      if (!r.ok) return setError(r.error ?? "Could not send the code. Please try again.");
      setSentTo(normalized);
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
    } catch {
      setError("Could not send the code. Please try again.");
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
      const r = await postJson("/api/auth/email/verify", { email: sentTo, code });
      if (!r.ok) return setError(r.error ?? "Login failed. Please try again.");
      afterLogin(router, returnTo, r.needsProfile);
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!sentTo ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
            <p className="text-muted-foreground text-xs">
              Forgot your password? We&apos;ll email you a code to log in. Works for accounts with a
              verified email.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <p className="text-muted-foreground text-sm">
            If <span className="text-foreground font-medium">{sentTo}</span> is verified on an
            account, we sent it a 6-digit code.{" "}
            <button
              type="button"
              className="min-h-tap text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setSentTo(null);
                setCode("");
              }}
            >
              Change email
            </button>
          </p>
          <div className="space-y-2">
            <Label htmlFor="login-email-code">Code from the email</Label>
            <Input
              id="login-email-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Verify and log in"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy || cooldown > 0}
            onClick={() => sendCode()}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </Button>
        </form>
      )}

      <Button type="button" variant="outline" className="mt-4 w-full" onClick={onBack}>
        Back to login
      </Button>
      {otpMode() === "stub" ? (
        <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed p-3 text-xs">
          Development mode: without an email provider the code is printed in the server console.
        </p>
      ) : null}
    </div>
  );
}
