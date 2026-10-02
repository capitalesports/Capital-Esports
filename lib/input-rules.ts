/**
 * Input rules that client components also need (phone normalising, Riot ID parsing, safe redirects…).
 * Deliberately Zod-free so importing them never ships Zod to the browser; lib/validators.ts builds the
 * server-side Zod schemas on top of these and re-exports them.
 */
import type { Game } from "./games";

/** Normalise user input ("98765 43210", "+91-9876543210") to E.164, or null if invalid. */
export function normalizePhone(input: string, defaultCountryCode = "+91"): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `${defaultCountryCode}${digits}`;
  else if (digits.length === 12 && digits.startsWith("91")) e164 = `+${digits}`;
  else return null;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  // Indian mobile numbers: +91 followed by 10 digits starting 6-9.
  if (e164.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(e164)) return null;
  return e164;
}

/** Trimmed, lower-cased email, or null if it doesn't look like one (the code we send proves it). */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export const MIN_AGE = 10;
export const MAX_AGE = 100;

/** Whole years between `dob` and `now` (UTC calendar). */
export function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const VALORANT_REGIONS = ["AP", "EU", "NA", "KR", "LATAM", "BR"] as const;

export interface RiotId {
  name: string;
  tag: string;
}

/**
 * Parse a Riot ID "Name#Tag". Name: 3–16 characters (letters, numbers, spaces);
 * tag: 3–5 letters/numbers. Returns null when invalid.
 */
export function parseRiotId(input: string): RiotId | null {
  const value = input.trim();
  const hash = value.lastIndexOf("#");
  if (hash <= 0 || value.indexOf("#") !== hash) return null;
  const name = value.slice(0, hash).trim();
  const tag = value.slice(hash + 1).trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} ]+$/u.test(name)) return null;
  if (!/^[\p{L}\p{N}]{3,5}$/u.test(tag)) return null;
  return { name, tag };
}

export function isValidRiotId(input: string): boolean {
  return parseRiotId(input) !== null;
}

/** Canonical (unique) key for a game ID. Riot IDs are case-insensitive. */
export function canonicalGameId(game: Game, gameId: string): string {
  const trimmed = gameId.trim();
  if (game !== "VALORANT") return trimmed;
  const riot = parseRiotId(trimmed);
  return riot ? `${riot.name}#${riot.tag}`.toLowerCase() : trimmed.toLowerCase();
}

/** Only allow same-site relative paths as post-login redirects (no open redirects). */
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

/** Account deletion requests (DECISIONS M39): the player's optional reason, the admin's note. */
export const DELETION_REASON_MAX = 500;
export const DELETION_NOTE_MAX = 300;
