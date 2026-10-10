/**
 * Referrals (DECISIONS M52), pure: code format, code generation and the per-referrer summary.
 * A player shares a link (/r/CODE) or the code itself; the new account remembers who referred it,
 * and staff can follow which referred players book (paid) slots.
 */

/** Cookie that carries a referral code from /r/CODE (or the sign-up form) to account creation. */
export const REFERRAL_COOKIE = "ce_ref";
export const REFERRAL_COOKIE_DAYS = 30;
/** Only a brand-new account can be credited to a referrer. */
export const REFERRAL_CLAIM_WINDOW_HOURS = 24;

/** No 0/O or 1/I: codes are read out loud and typed on phones. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "capital7x " → "CAPITAL7X"; null when it can't be a code (4–12 letters/digits). */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

/** A new code: up to 6 letters/digits of the player's name, then 3 random characters ("CAPITA7XK"). */
export function referralCodeFor(name: string | null, random: () => number = Math.random): string {
  const base =
    (name ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "PLAYER";
  let tail = "";
  for (let i = 0; i < 3; i++) tail += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return base + tail;
}

export function referralPath(code: string): string {
  return `/r/${code}`;
}

export interface ReferredPlayer {
  userId: string;
  referrerId: string;
  /** Booked (confirmed) slots, free or paid. */
  slots: number;
  /** Paid entries (payment completed). */
  paidSlots: number;
  paidPaise: number;
  lastPaidAt: Date | null;
}

export interface ReferrerSummary {
  referrerId: string;
  joined: number;
  /** Referred players with at least one booked slot. */
  booked: number;
  /** Referred players with at least one paid slot. */
  paidPlayers: number;
  slots: number;
  paidSlots: number;
  paidPaise: number;
  lastPaidAt: Date | null;
}

/** One row per referrer, most paid entries first, then most players joined. */
export function summarizeReferrals(players: ReferredPlayer[]): ReferrerSummary[] {
  const by = new Map<string, ReferrerSummary>();
  for (const p of players) {
    const s = by.get(p.referrerId) ?? {
      referrerId: p.referrerId,
      joined: 0,
      booked: 0,
      paidPlayers: 0,
      slots: 0,
      paidSlots: 0,
      paidPaise: 0,
      lastPaidAt: null,
    };
    s.joined += 1;
    if (p.slots > 0) s.booked += 1;
    if (p.paidSlots > 0) s.paidPlayers += 1;
    s.slots += p.slots;
    s.paidSlots += p.paidSlots;
    s.paidPaise += p.paidPaise;
    if (p.lastPaidAt && (!s.lastPaidAt || p.lastPaidAt > s.lastPaidAt)) s.lastPaidAt = p.lastPaidAt;
    by.set(p.referrerId, s);
  }
  return [...by.values()].sort(
    (a, b) => b.paidSlots - a.paidSlots || b.joined - a.joined || b.slots - a.slots,
  );
}

export const REFERRAL_PERIODS = ["7d", "30d", "all"] as const;
export type ReferralPeriod = (typeof REFERRAL_PERIODS)[number];

export const PERIOD_LABEL: Record<ReferralPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

/** ?period=… from the URL; anything unknown means all time. */
export function referralPeriodFrom(raw: unknown): ReferralPeriod {
  return (REFERRAL_PERIODS as readonly unknown[]).includes(raw) ? (raw as ReferralPeriod) : "all";
}

/** Start of the period (null = all time). */
export function periodStart(period: ReferralPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000);
}

/** Reward (DECISIONS M52): every 5 referred players who book a paid slot earn 1 free slot. */
export const REFERRALS_PER_FREE_SLOT = 5;
/** A referred player's paid slot counts only from this entry fee (no ₹1 entries to farm rewards). */
export const REFERRAL_MIN_QUALIFYING_FEE_PAISE = 5_000;
/** A free slot covers entries up to this fee. */
export const FREE_SLOT_MAX_FEE_PAISE = 10_000;

export interface ReferralRewards {
  /** Free slots earned so far. */
  earned: number;
  used: number;
  available: number;
  /** Paid referred players counted toward the next free slot (0–4). */
  towardNext: number;
}

export function referralRewards(paidPlayers: number, used: number): ReferralRewards {
  const earned = Math.floor(Math.max(0, paidPlayers) / REFERRALS_PER_FREE_SLOT);
  return {
    earned,
    used,
    available: Math.max(0, earned - used),
    towardNext: Math.max(0, paidPlayers) % REFERRALS_PER_FREE_SLOT,
  };
}
