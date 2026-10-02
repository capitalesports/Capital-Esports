"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/common/native-select";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_TIME,
  joinValue,
  label12h,
  nextDays,
  PICKER_MINUTES,
  QUICK_TIMES,
  splitValue,
  summary,
  timeOf,
  to24h,
} from "@/lib/date-time-picker";
import { chipClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * Admin date + time picker in IST: day chips (Today, Tomorrow, …) with a calendar for other days,
 * common start times, and hour / minute / AM-PM controls. `value` is a datetime-local string
 * ("2026-10-02T20:00", IST), so it drops in where `<Input type="datetime-local">` was.
 */
export function IstDateTimePicker({
  id,
  label,
  value,
  onChange,
  optional = false,
  invalid = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shows a "Clear" button (e.g. "registration opens at", which may stay empty). */
  optional?: boolean;
  invalid?: boolean;
}) {
  const [days] = useState(() => nextDays(new Date()));
  const parts = splitValue(value);
  const time = timeOf(value);
  const chipDay = days.some((d) => d.date === parts.date);
  const minutes = PICKER_MINUTES.includes(parts.minute as (typeof PICKER_MINUTES)[number])
    ? PICKER_MINUTES
    : [...PICKER_MINUTES, parts.minute].sort((a, b) => a - b);

  const setDay = (date: string) => onChange(joinValue(date, time ?? DEFAULT_TIME));
  const setTime = (t: string) => onChange(joinValue(parts.date || days[0]!.date, t));
  const setParts = (next: Partial<{ hour12: number; minute: number; pm: boolean }>) =>
    setTime(
      to24h(next.hour12 ?? parts.hour12 ?? 8, next.minute ?? parts.minute, next.pm ?? parts.pm),
    );
  const text = summary(value);

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      aria-describedby={`${id}-help ${id}-error`}
      className={cn(
        "border-border bg-surface space-y-3 rounded-lg border p-3",
        invalid && "border-destructive",
      )}
    >
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">Day</p>
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              aria-pressed={parts.date === d.date}
              onClick={() => setDay(d.date)}
              className={cn(
                chipClass(parts.date === d.date),
                "min-w-16 flex-col justify-center px-3 py-1 leading-tight",
              )}
            >
              <span>{d.top}</span>
              <span className="text-muted-foreground text-xs">{d.bottom}</span>
            </button>
          ))}
          <label
            className={cn(
              chipClass(!!parts.date && !chipDay),
              "relative gap-2 px-3 focus-within:ring-3 focus-within:ring-ring/50",
            )}
          >
            <span>Other date</span>
            <Input
              type="date"
              aria-label={`${label}: other date`}
              value={chipDay ? "" : parts.date}
              min={days[0]!.date}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="h-9 w-auto border-0 bg-transparent px-1"
            />
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">Time</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TIMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={time === t}
              onClick={() => setTime(t)}
              className={cn(chipClass(time === t), "px-3")}
            >
              {label12h(t)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={`${label}: hour`}
            aria-invalid={invalid || undefined}
            value={parts.hour12 ?? ""}
            onChange={(e) => setParts({ hour12: Number(e.target.value) })}
            className="w-20"
          >
            {parts.hour12 === null ? <option value="">Hour</option> : null}
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </NativeSelect>
          <span aria-hidden className="font-semibold">
            :
          </span>
          <NativeSelect
            aria-label={`${label}: minutes`}
            value={parts.minute}
            onChange={(e) => setParts({ minute: Number(e.target.value) })}
            className="w-20"
          >
            {minutes.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </NativeSelect>
          <div className="flex gap-1" role="group" aria-label={`${label}: AM or PM`}>
            {(["AM", "PM"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={time !== null && parts.pm === (p === "PM")}
                onClick={() => setParts({ pm: p === "PM" })}
                className={cn(chipClass(time !== null && parts.pm === (p === "PM")), "px-3")}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-tap items-center justify-between gap-2">
        <p aria-live="polite" className={cn("text-sm font-semibold", text ? "text-gold" : "text-muted-foreground")}>
          {text ?? "Pick a day and a time"}
        </p>
        {optional && value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-foreground min-h-tap px-2 text-sm underline-offset-4 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
