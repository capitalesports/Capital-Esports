"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "@/lib/referral";

/** Keep the typed code in the referral cookie so it applies to email and Google sign-up alike. */
function rememberCode(code: string) {
  const value = code.trim().toUpperCase();
  document.cookie = value
    ? `${REFERRAL_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${REFERRAL_COOKIE_DAYS * 86_400}; samesite=lax`
    : `${REFERRAL_COOKIE}=; path=/; max-age=0`;
}

/** Optional referral code on the sign-up page (DECISIONS M52); filled in from a /r/CODE link. */
export function ReferralCodeField({ initial }: { initial: string | null }) {
  const [code, setCode] = useState(initial ?? "");
  return (
    <div className="space-y-2">
      <Label htmlFor="signup-referral">
        Referral code <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      <Input
        id="signup-referral"
        value={code}
        onChange={(e) => {
          const next = e.target.value
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 12)
            .toUpperCase();
          setCode(next);
          rememberCode(next);
        }}
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="e.g. KHUSHI7XK"
        aria-describedby="signup-referral-help"
      />
      <p id="signup-referral-help" className="text-muted-foreground text-xs">
        Got a code from a friend? Enter it here. It also works with Continue with Google.
      </p>
    </div>
  );
}
