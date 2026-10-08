"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IntentLink } from "@/components/common/intent-link";
import { FieldError } from "@/components/common/field-error";
import { DobPicker } from "@/components/profile/dob-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeEmail } from "@/lib/input-rules";
import { afterLogin, postJson } from "./auth-post";
import { GoogleLogin } from "./google-login";
import { OrDivider } from "./login-form";
import { otpMode } from "./otp-client";
import { PasswordInput } from "./password-input";
import { ReferralCodeField } from "./referral-code-field";
import { useCountdown } from "./use-countdown";

const RESEND_COOLDOWN_MS = 30_000;
const MIN_PASSWORD = 8;

type Fields = "displayName" | "email" | "dateOfBirth" | "password" | "code";
type FieldErrors = Partial<Record<Fields, string[] | undefined>>;

/**
 * Create an account with username, email, date of birth and password (DECISIONS M38), then enter
 * the 6-digit code sent to the email. "Continue with Google" is the one-tap alternative.
 */
export function SignupForm({
  returnTo,
  referralCode = null,
}: {
  returnTo: string | null;
  /** From a /r/CODE link (or a code typed earlier). */
  referralCode?: string | null;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const cooldown = useCountdown(resendAt);

  function check(): FieldErrors {
    const errors: FieldErrors = {};
    if (displayName.trim().length < 2) errors.displayName = ["Enter a username (2–30 characters)"];
    if (!normalizeEmail(email)) errors.email = ["Enter a valid email address"];
    if (!dateOfBirth) errors.dateOfBirth = ["Choose your day, month and year of birth"];
    if (password.length < MIN_PASSWORD) {
      errors.password = [`Use at least ${MIN_PASSWORD} characters`];
    }
    return errors;
  }

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const errors = check();
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const r = await postJson("/api/auth/signup", {
        displayName: displayName.trim(),
        email: normalizeEmail(email),
        dateOfBirth,
        password,
      });
      if (!r.ok) {
        setFieldErrors(r.fieldErrors ?? {});
        return setError(r.error ?? "Could not create the account. Please try again.");
      }
      setSentTo(r.email ?? normalizeEmail(email));
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
    } catch {
      setError("Could not create the account. Please try again.");
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
      const r = await postJson("/api/auth/signup/verify", { email: sentTo, code });
      if (!r.ok) return setError(r.error ?? "That code didn't work. Please try again.");
      afterLogin(router, returnTo, r.needsProfile);
    } catch {
      setError("That code didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const loginHref = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";

  return (
    <div className="mx-auto w-full max-w-sm">
      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!sentTo ? (
        <form onSubmit={start} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="signup-name">Username</Label>
            <Input
              id="signup-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              maxLength={30}
              aria-invalid={!!fieldErrors.displayName || undefined}
              aria-describedby="signup-name-error"
              required
            />
            <FieldError id="signup-name-error" messages={fieldErrors.displayName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!fieldErrors.email || undefined}
              aria-describedby="signup-email-error"
              required
            />
            <FieldError id="signup-email-error" messages={fieldErrors.email} />
          </div>
          <div className="space-y-2">
            <Label id="dob-label">Date of birth</Label>
            <DobPicker
              value={dateOfBirth}
              onChange={setDateOfBirth}
              invalid={!!fieldErrors.dateOfBirth}
              describedBy="signup-dob-error"
            />
            <FieldError id="signup-dob-error" messages={fieldErrors.dateOfBirth} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <PasswordInput
              id="signup-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={!!fieldErrors.password}
              describedBy="signup-password-help"
            />
            {fieldErrors.password ? (
              <FieldError id="signup-password-help" messages={fieldErrors.password} />
            ) : (
              <p id="signup-password-help" className="text-muted-foreground text-xs">
                At least {MIN_PASSWORD} characters.
              </p>
            )}
          </div>
          <ReferralCodeField initial={referralCode} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <p className="text-muted-foreground text-sm">
            We sent a 6-digit code to <span className="text-foreground font-medium">{sentTo}</span>.
            Enter it to finish creating your account.{" "}
            <button
              type="button"
              className="min-h-tap text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setSentTo(null);
                setCode("");
              }}
            >
              Change details
            </button>
          </p>
          <div className="space-y-2">
            <Label htmlFor="signup-code">Code from the email</Label>
            <Input
              id="signup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy || cooldown > 0}
            onClick={() => start()}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </Button>
          {otpMode() === "stub" ? (
            <p className="border-border text-muted-foreground rounded-md border border-dashed p-3 text-xs">
              Development mode: without an email provider the code is printed in the server console.
            </p>
          ) : null}
        </form>
      )}

      {!sentTo ? (
        <>
          <OrDivider />
          <GoogleLogin returnTo={returnTo} />
          <p className="text-muted-foreground mt-6 text-center text-sm">
            Already have an account?{" "}
            <IntentLink
              href={loginHref}
              className="min-h-tap text-primary inline-flex items-center font-medium underline-offset-4 hover:underline"
            >
              Log in
            </IntentLink>
          </p>
        </>
      ) : null}
    </div>
  );
}
