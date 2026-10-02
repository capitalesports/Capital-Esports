/**
 * Time helpers. Everything is stored in UTC and displayed in IST (UTC+05:30, no DST).
 */

export const IST_TIME_ZONE = "Asia/Kolkata";
export const IST_OFFSET_MINUTES = 330;

const MINUTE = 60_000;

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "Sat, 27 Sept, 6:30 pm IST" */
export function formatIST(date: Date): string {
  return `${dateTimeFmt.format(date)} IST`;
}

/** "Saturday, 27 September" */
export function formatDateIST(date: Date): string {
  return dateFmt.format(date);
}

/** IST calendar day as "YYYY-MM-DD". */
export function istDayKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 10);
}

/** UTC instant of 00:00 IST on the IST day containing `date`, shifted by `addDays`. */
export function startOfIstDay(date: Date, addDays = 0): Date {
  const key = istDayKey(date);
  const midnightUtcOfKey = new Date(`${key}T00:00:00.000Z`).getTime();
  return new Date(midnightUtcOfKey - IST_OFFSET_MINUTES * MINUTE + addDays * 24 * 60 * MINUTE);
}

/**
 * Parse an admin form value from <input type="datetime-local"> ("2026-09-27T18:30"),
 * interpreted as IST, into a UTC Date. Returns null if malformed.
 */
export function istInputToUtc(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const asUtc = new Date(`${value.length === 16 ? `${value}:00` : value}.000Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  return new Date(asUtc.getTime() - IST_OFFSET_MINUTES * MINUTE);
}

/** Inverse of istInputToUtc: UTC Date -> "YYYY-MM-DDTHH:mm" in IST for datetime-local inputs. */
export function utcToIstInput(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 16);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function addDays(date: Date, days: number): Date {
  return addMinutes(date, days * 24 * 60);
}

/** "Today" / "Tomorrow" / "Mon, 29 Sept" relative to `now`, by IST calendar day. */
export function istDayLabel(date: Date, now = new Date()): string {
  const day = istDayKey(date);
  if (day === istDayKey(now)) return "Today";
  if (day === istDayKey(addDays(now, 1))) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The IST wall-clock fields of an instant (shifted so UTC getters read IST). */
function istParts(date: Date) {
  const d = new Date(date.getTime() + IST_OFFSET_MINUTES * MINUTE);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    weekday: d.getUTCDay(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

/** "06:00 PM" — two-digit 12-hour clock, as on the design's match cards; `pad: false` gives "6:00 PM". */
export function formatClockIST(date: Date, { pad = true }: { pad?: boolean } = {}): string {
  const { hours, minutes } = istParts(date);
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad ? String(h12).padStart(2, "0") : h12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** "28 Sep" (design spelling; Intl's en-IN gives "Sept"). */
export function shortDateIST(date: Date): string {
  const { day, month } = istParts(date);
  return `${day} ${SHORT_MONTHS[month]}`;
}

/** "Mon" */
export function shortWeekdayIST(date: Date): string {
  return SHORT_WEEKDAYS[istParts(date).weekday]!;
}
