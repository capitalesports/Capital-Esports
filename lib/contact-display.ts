/**
 * Showing a player their own phone, email and date of birth (client-safe, pure).
 * Contact details are masked until the player chooses to reveal them.
 */

/** "+918742968987" → "+91 ••••••8987" (country code and last 4 digits stay). */
export function maskPhone(phone: string): string {
  const m = /^(\+91|\+\d{1,3}?)(\d+)$/.exec(phone);
  if (!m) return phone;
  const [, cc, rest] = m as unknown as [string, string, string];
  return `${cc} ${"•".repeat(Math.max(0, rest.length - 4))}${rest.slice(-4)}`;
}

/** "+918742968987" → "+91 87429 68987" (Indian numbers grouped 5+5). */
export function formatPhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

/** "player@gmail.com" → "p•••••@gmail.com" */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}${"•".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface DobParts {
  day: number | null;
  /** 1–12 */
  month: number | null;
  year: number | null;
}

export function splitDob(value: string): DobParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { day: null, month: null, year: null };
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function daysInMonth(month: number | null, year: number | null): number {
  if (!month) return 31;
  return new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" once day, month and year are all picked (day clamped to the month), else "". */
export function joinDob({ day, month, year }: DobParts): string {
  if (!day || !month || !year) return "";
  const d = Math.min(day, daysInMonth(month, year));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Birth years offered, newest first: players aged `minAge` to `maxAge`. */
export function dobYears(now: Date, minAge: number, maxAge: number): number[] {
  const newest = now.getUTCFullYear() - minAge;
  return Array.from({ length: maxAge - minAge + 1 }, (_, i) => newest - i);
}
