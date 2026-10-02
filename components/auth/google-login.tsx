"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { siGoogle } from "simple-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeEmail, safeReturnTo } from "@/lib/input-rules";
import {
  GoogleSignInError,
  googleIdTokenFromPopup,
  googleMode,
  postGoogleToken,
  stubGoogleToken,
} from "./google-client";

/**
 * "Continue with Google" (DECISIONS M29, M31): signs in, or creates the account straight away (no
 * phone needed); a new player then finishes their profile (date of birth).
 */
export function GoogleLogin({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devForm, setDevForm] = useState(false);
  const [devEmail, setDevEmail] = useState("");
  const [devName, setDevName] = useState("");

  async function finish(idToken: string) {
    const r = await postGoogleToken(idToken);
    if (!r.ok) return setError(r.error ?? "Google sign-in failed. Please try again.");
    const target = safeReturnTo(returnTo);
    router.replace(r.needsProfile ? `/profile?returnTo=${encodeURIComponent(target)}` : target);
    router.refresh();
  }

  async function start() {
    setError(null);
    if (googleMode() === "stub") return setDevForm(true);
    setBusy(true);
    try {
      await finish(await googleIdTokenFromPopup());
    } catch (e) {
      setError(e instanceof GoogleSignInError ? e.message : "Google sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {devForm ? (
        <form
          className="border-border space-y-3 rounded-md border border-dashed p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = normalizeEmail(devEmail);
            if (!email) return setError("Enter a valid email address.");
            setBusy(true);
            try {
              await finish(stubGoogleToken(email, devName));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-muted-foreground text-xs">
            Development mode: Google isn&apos;t connected yet, so type the Google account&apos;s
            email and name to try the flow.
          </p>
          <div className="space-y-1">
            <Label htmlFor="dev-google-email">Google email</Label>
            <Input
              id="dev-google-email"
              type="email"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dev-google-name">Name on Google</Label>
            <Input
              id="dev-google-name"
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Continue"}
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={busy}
          onClick={start}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-4">
            <path d={siGoogle.path} />
          </svg>
          {busy ? "Opening Google…" : "Continue with Google"}
        </Button>
      )}
    </div>
  );
}
