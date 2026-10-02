/**
 * Pure helpers for the admin IST date-time picker. The value is the same string a
 * datetime-local input produces ("2026-10-02T20:00", read as IST), so forms and schemas don't change.
 */
import { addDays, istDayKey } from "./time";

export interface PickerParts {
  /** "YYYY-MM-DD" (IST) or "" */
  date: string;
  /** 1–12, or null when no time is set */
  hour12: number | null;
  minute: number;
  pm: boolean;
}

const VALUE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** Minutes offered in the minute dropdown. */
export const PICKER_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

/** Common start times (24 h): lunch, afternoon, evening and night scrims. */
export const QUICK_TIMES = ["12:00", "14:00", "16:00", "18:00", "20:00", "21:00", "22:00"] as const;

/** Time used when a day is picked before any time: the usual evening slot. */
export const DEFAULT_TIME = "20:00";

export function splitValue(value: string): PickerParts {
  const m = VALUE_RE.exec(value);
  if (!m) return { date: "", hour12: null, minute: 0, pm: true };
  const h = Number(m[2]);
  return { date: m[1]!, hour12: h % 12 === 0 ? 12 : h % 12, minute: Number(m[3]), pm: h >= 12 };
}

/** "HH:mm" (24 h) from 12-hour parts. */
export function to24h(hour12: number, minute: number, pm: boolean): string {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "YYYY-MM-DDTHH:mm", or "" without a date. */
export function joinValue(date: string, time: string): string {
  return date ? `${date}T${time}` : "";
}

/** The 24 h time of a value, or null. */
export function timeOf(value: string): string | null {
  const m = VALUE_RE.exec(value);
  return m ? `${m[2]}:${m[3]}` : null;
}

/** "8:00 PM" from "20:00". */
export function label12h(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` : `${h12} ${h >= 12 ? "PM" : "AM"}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Thu, 2 Oct" for an IST "YYYY-MM-DD" key. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface DayChip {
  date: string;
  /** "Today", "Tomorrow" or "Sat" */
  top: string;
  /** "2 Oct" */
  bottom: string;
}

/** The next `count` IST days starting today, as quick-pick chips. */
export function nextDays(now: Date, count = 7): DayChip[] {
  return Array.from({ length: count }, (_, i) => {
    const date = istDayKey(addDays(now, i));
    const d = new Date(`${date}T00:00:00.000Z`);
    return {
      date,
      top: i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[d.getUTCDay()]!,
      bottom: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
    };
  });
}

/** "Thu, 2 Oct · 8:00 PM IST", or null when incomplete. */
export function summary(value: string): string | null {
  const time = timeOf(value);
  const { date } = splitValue(value);
  return date && time ? `${dayLabel(date)} · ${label12h(time)} IST` : null;
}
