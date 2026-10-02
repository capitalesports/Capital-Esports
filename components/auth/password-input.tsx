"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Password field with a show/hide button (players often type on a phone). */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="pr-12"
        required
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="text-muted-foreground hover:text-foreground min-h-tap min-w-tap absolute top-1/2 right-0 inline-flex -translate-y-1/2 items-center justify-center rounded-md"
      >
        {shown ? (
          <EyeOffIcon aria-hidden className="size-4" />
        ) : (
          <EyeIcon aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}
