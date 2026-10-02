"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IntentLink } from "@/components/common/intent-link";
import { normalizeEmail, normalizePhone } from "@/lib/input-rules";
import { afterLogin, postJson } from "./auth-post";
import { EmailLoginForm } from "./email-login-form";
import { GoogleLogin } from "./google-login";
import { PasswordInput } from "./password-input";
import { phoneLoginEnabled } from "@/lib/phone-login";
import { createOtpClient, OtpError, otpMode, STUB_OTP_CODE, type OtpClient } from "./otp-client";
import { useCountdown } from "./use-countdown";

const RESEND_COOLDOWN_MS = 30_000;
const RECAPTCHA_ID = "recaptcha-container";

type Step = "phone" | "code";

/**
 * Email + password (players: DECISIONS M38; staff: M18), "Continue with Google" (M29, M31) and,
 * when switched on, phone OTP (M37). "Forgot password?" logs in with a code sent to the email.
 */
export function LoginForm({ returnTo }: { returnTo: string | null }) {
  const [method, setMethod] = useState<"password" | "email-code">("password");
  if (method === "email-code") {
    return <EmailLoginForm returnTo={returnTo} onBack={() => setMethod("password")} />;
  }
  const signupHref = returnTo ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup";
  return (
    <div className="mx-auto w-full max-w-sm">
      <PasswordLoginForm returnTo={returnTo} onForgot={() => setMethod("email-code")} />
      <OrDivider />
      <GoogleLogin returnTo={returnTo} />
      {phoneLoginEnabled() ? (
        <>
          <OrDivider label="or use your mobile number" />
          <PhoneLoginForm returnTo={returnTo} />
        </>
      ) : null}
      <p className="text-muted-foreground mt-6 text-center text-sm">
        New here?{" "}
        <IntentLink
          href={signupHref}
          className="min-h-tap text-primary inline-flex items-center font-medium underline-offset-4 hover:underline"
        >
          Create an account
        </IntentLink>
      </p>
    </div>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <p className="text-muted-foreground my-4 flex items-center gap-3 text-xs">
      <span className="bg-border h-px flex-1" />
      {label}
      <span className="bg-border h-px flex-1" />
    </p>
  );
}

function PasswordLoginForm({
  returnTo,
  onForgot,
}: {
  returnTo: string | null;
  onForgot: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeEmail(email);
    if (!normalized) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      const r = await postJson("/api/auth/password", { email: normalized, password });
      if (!r.ok) return setError(r.error ?? "Login failed. Please try again.");
      afterLogin(router, returnTo, r.needsProfile);
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="login-password">Password</Label>
          <button
            type="button"
            onClick={onForgot}
            className="min-h-tap text-primary text-xs underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <PasswordInput
          id="login-password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}

function PhoneLoginForm({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const clientRef = useRef<OtpClient | null>(null);
  const [step, setStep] = useState<Step>("phone");
  const [countryCode, setCountryCode] = useState("+91");
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const cooldown = useCountdown(resendAt);

  function client(): OtpClient {
    clientRef.current ??= createOtpClient(RECAPTCHA_ID);
    return clientRef.current;
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const normalized = normalizePhone(
      number.startsWith("+") ? number : `${countryCode}${number.replace(/^0+/, "")}`,
    );
    if (!normalized) {
      setError("Enter a valid mobile number.");
      return;
    }
    setBusy(true);
    try {
      await client().sendCode(normalized);
      setPhone(normalized);
      setStep("code");
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
    } catch (err) {
      setError(
        err instanceof OtpError ? err.message : "Could not send the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const idToken = await client().confirmCode(code);
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; needsProfile?: boolean };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Login failed. Please try again.");
        return;
      }
      afterLogin(router, returnTo, body.needsProfile);
    } catch (err) {
      setError(err instanceof OtpError ? err.message : "Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const isStub = otpMode() === "stub";

  return (
    <div className="mx-auto w-full max-w-sm">
      {error ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === "phone" ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="phone">Mobile number</Label>
            <div className="flex gap-2">
              <Input
                aria-label="Country code"
                className="w-20"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                inputMode="tel"
                autoComplete="tel-country-code"
              />
              <Input
                id="phone"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <p className="text-muted-foreground text-sm">
            Enter the 6-digit code sent to{" "}
            <span className="text-foreground font-medium">{phone}</span>.{" "}
            <button
              type="button"
              className="min-h-tap text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setStep("phone");
                setCode("");
              }}
            >
              Change number
            </button>
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
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

      {isStub ? (
        <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed p-3 text-xs">
          Development mode: no SMS is sent. Use code <strong>{STUB_OTP_CODE}</strong>.
        </p>
      ) : null}
      <div id={RECAPTCHA_ID} />
    </div>
  );
}
