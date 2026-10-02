"use client";

import { useState } from "react";
import { LockIcon } from "lucide-react";
import { updateProfileAction } from "@/app/(site)/profile/actions";
import { FieldError } from "@/components/common/field-error";
import { IntentLink as Link } from "@/components/common/intent-link";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MONTH_NAMES, splitDob } from "@/lib/contact-display";
import { ageOn } from "@/lib/input-rules";
import { DobPicker } from "./dob-picker";

export function ProfileDetailsForm({
  displayName,
  dateOfBirth,
}: {
  displayName: string | null;
  dateOfBirth: string | null;
}) {
  const [name, setName] = useState(displayName ?? "");
  const [dob, setDob] = useState(dateOfBirth ?? "");
  const { run, pending, fieldErrors } = useAction(updateProfileAction);
  const locked = !!dateOfBirth;
  const lockedParts = splitDob(dateOfBirth ?? "");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ displayName: name, dateOfBirth: dob });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!fieldErrors.displayName}
          aria-describedby="displayName-error"
          autoComplete="nickname"
          required
        />
        <FieldError id="displayName-error" messages={fieldErrors.displayName} />
      </div>
      {locked ? (
        // Set once: age and prize rules depend on it, so only support can change it (DECISIONS M19).
        <div className="space-y-1">
          <p className="text-sm font-medium" id="dob-label">
            Date of birth
          </p>
          <p className="flex items-center gap-1.5 text-sm">
            <LockIcon aria-hidden className="text-gold size-4" />
            {lockedParts.day} {MONTH_NAMES[lockedParts.month! - 1]} {lockedParts.year} ·{" "}
            {ageOn(new Date(`${dateOfBirth}T00:00:00Z`), new Date())} years old
          </p>
          <p className="text-muted-foreground text-xs">
            Locked once saved. To correct it,{" "}
            <Link href="/contact" className="text-gold underline-offset-4 hover:underline">
              contact support
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label id="dob-label">Date of birth</Label>
          <DobPicker
            value={dob}
            onChange={setDob}
            invalid={!!fieldErrors.dateOfBirth}
            describedBy="dateOfBirth-help dateOfBirth-error"
          />
          <p id="dateOfBirth-help" className="text-muted-foreground text-xs">
            Needed for paid entry and prize rules. Never shown publicly. You can&apos;t change it
            after saving, so check it carefully.
          </p>
          <FieldError id="dateOfBirth-error" messages={fieldErrors.dateOfBirth} />
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}
