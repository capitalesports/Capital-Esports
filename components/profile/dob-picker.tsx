"use client";

import { useState } from "react";
import { CakeIcon } from "lucide-react";
import { NativeSelect } from "@/components/common/native-select";
import {
  daysInMonth,
  dobYears,
  joinDob,
  MONTH_NAMES,
  splitDob,
  type DobParts,
} from "@/lib/contact-display";
import { ageOn, MAX_AGE, MIN_AGE } from "@/lib/input-rules";
import { cn } from "@/lib/utils";

/**
 * Date of birth as three dropdowns (day, month, year) instead of a calendar: quicker to pick a
 * birth year on a phone. Calls `onChange` with "YYYY-MM-DD" once all three are chosen, else "".
 */
export function DobPicker({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [parts, setParts] = useState<DobParts>(() => splitDob(value));
  const [years] = useState(() => dobYears(new Date(), MIN_AGE, MAX_AGE));
  const days = daysInMonth(parts.month, parts.year);
  const full = joinDob(parts);
  const age = full ? ageOn(new Date(`${full}T00:00:00Z`), new Date()) : null;

  function update(next: Partial<DobParts>) {
    const merged = { ...parts, ...next };
    if (merged.day && merged.day > daysInMonth(merged.month, merged.year)) {
      merged.day = daysInMonth(merged.month, merged.year);
    }
    setParts(merged);
    onChange(joinDob(merged));
  }

  const selectClass = cn("bg-surface", invalid && "border-destructive");
  return (
    <div
      role="group"
      aria-labelledby="dob-label"
      aria-describedby={describedBy}
      className="space-y-2"
    >
      <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
        <NativeSelect
          aria-label="Day"
          aria-invalid={invalid || undefined}
          value={parts.day ?? ""}
          onChange={(e) => update({ day: Number(e.target.value) || null })}
          className={selectClass}
        >
          <option value="">Day</option>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Month"
          aria-invalid={invalid || undefined}
          value={parts.month ?? ""}
          onChange={(e) => update({ month: Number(e.target.value) || null })}
          className={selectClass}
        >
          <option value="">Month</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Year"
          aria-invalid={invalid || undefined}
          value={parts.year ?? ""}
          onChange={(e) => update({ year: Number(e.target.value) || null })}
          className={selectClass}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
      </div>
      {age !== null ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm" aria-live="polite">
          <CakeIcon aria-hidden className="text-gold size-4" />
          {parts.day} {MONTH_NAMES[parts.month! - 1]} {parts.year} · {age} years old
        </p>
      ) : null}
    </div>
  );
}
