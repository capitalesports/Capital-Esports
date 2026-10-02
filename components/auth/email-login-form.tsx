"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeEmail, safeReturnTo } from "@/lib/input-rules";
import { otpMode } from "./otp-client";
import { useCountdown } from "./use-countdown";

const RESEND_COOLDOWN_MS = 30_000;

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    needsProfile?: boolean;
  };
  return { ok: res.ok && !!json.ok, ...json };
}

/** Log in with a code sent to the account's verified email (accounts are created with a phone). */
export function EmailLoginForm({
  returnTo,
  onUsePhone,
}: {
  returnTo: string | null;
  onUsePhone: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const cooldown = useCountdown(resendAt);
  // Staff (admins, moderators) can log in with their email and password (DECISIONS M18).
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState("");

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeEmail(email);
    if (!normalized) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      const r = await post("/api/auth/password", { email: normalized, password });
      if (!r.ok) return setError(r.error ?? "Login failed. Please try again.");
      const target = safeReturnTo(returnTo);
      router.replace(r.needsProfile ? `/profile?returnTo=${encodeURIComponent(target)}` : target);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const normalized = normalizeEmail(sentTo ?? email);
    if (!normalized) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await post("/api/auth/email/request", { email: normalized });
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
      const r = await post("/api/auth/email/verify", { email: sentTo, code });
      if (!r.ok) return setError(r.error ?? "Login failed. Please try again.");
      const target = safeReturnTo(returnTo);
      router.replace(r.needsProfile ? `/profile?returnTo=${encodeURIComponent(target)}` : target);
      router.refresh();
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

      {withPassword ? (
        <form onSubmit={passwordLogin} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <p className="text-muted-foreground text-xs">For admins and moderators.</p>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
      ) : !sentTo ? (
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
              Works for accounts that verified this email on their profile. New here? Sign up with
              your phone number.
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

      <Button
        type="button"
        variant="ghost"
        className="mt-4 w-full"
        onClick={() => {
          setWithPassword((v) => !v);
          setSentTo(null);
          setCode("");
          setPassword("");
          setError(null);
        }}
      >
        {withPassword ? "Email me a code instead" : "Staff? Log in with password"}
      </Button>
      <Button type="button" variant="outline" className="mt-2 w-full" onClick={onUsePhone}>
        Use phone number instead
      </Button>
      {otpMode() === "stub" && !withPassword ? (
        <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed p-3 text-xs">
          Development mode: without an email provider the code is printed in the server console.
        </p>
      ) : null}
    </div>
  );
}
