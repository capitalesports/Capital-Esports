/**
 * /scrims page logic (docs/design/pages/scrims-desktop.png): URL query → filters → sorted lists.
 * Pure and framework-free; the page fetches the 4-day window once and applies these in memory.
 * Registration rules are not changed here: card status is derived from `cardAction`.
 */
import { gameFromSlug, GAME_CONFIG, type Game } from "./games";
import { MATCH_MODES, MODES_FOR_GAME, type MatchMode } from "./match-modes";
import type { MatchStatus } from "./match-state";
import { isOpenEntry } from "./lobbies";
import { cardAction } from "./registration-rules";
import { addDays, formatClockIST, istDayKey, shortDateIST, shortWeekdayIST } from "./time";

export const SCRIM_FEES = ["all", "free", "paid"] as const;
export const SCRIM_PRIZES = ["all", "under-1k", "1k-5k", "over-5k"] as const;
export const SCRIM_STATUSES = ["all", "open", "almost-full", "waitlist", "closed", "live"] as const;
export const SCRIM_SORTS = ["start", "prize", "fee", "slots"] as const;

export type ScrimFee = (typeof SCRIM_FEES)[number];
export type ScrimPrize = (typeof SCRIM_PRIZES)[number];
export type ScrimStatusFilter = (typeof SCRIM_STATUSES)[number];
export type ScrimSort = (typeof SCRIM_SORTS)[number];
/** Pill states; "upcoming" (registration not open yet) has a pill but no filter option. */
export type ScrimStatus = Exclude<ScrimStatusFilter, "all"> | "upcoming";

export const FEE_LABEL: Record<ScrimFee, string> = { all: "All", free: "Free", paid: "Paid" };
export const PRIZE_LABEL: Record<ScrimPrize, string> = {
  all: "All",
  "under-1k": "Under ₹1,000",
  "1k-5k": "₹1,000–5,000",
  "over-5k": "Above ₹5,000",
};
export const STATUS_FILTER_LABEL: Record<ScrimStatusFilter, string> = {
  all: "All",
  open: "Registration open",
  "almost-full": "Almost full",
  waitlist: "Waitlist",
  closed: "Closed",
  live: "Live",
};
export const SORT_LABEL: Record<ScrimSort, string> = {
  start: "Start Time",
  prize: "Prize Pool",
  fee: "Entry Fee",
  slots: "Slots left",
};

/** A card shows ALMOST FULL once this share of slots is taken (and it is not yet full). */
export const ALMOST_FULL_RATIO = 0.8;

const RUPEE = 100; // paise

export interface ScrimFields {
  game: Game;
  mode: MatchMode;
  title: string;
  startsAt: Date;
  status: MatchStatus;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date;
  entryFeePaise: number;
  prizePaise: number;
  maxSlots: number;
  _count: { registrations: number };
  /** Absent = a standalone scrim (open entry: never full, splits into lobbies). */
  isEntryList?: boolean;
  tournamentId?: string | null;
  bracketRound?: number | null;
  parentMatchId?: string | null;
}

/** Standalone scrims take unlimited entries (DECISIONS M11). */
export function scrimIsOpenEntry(m: ScrimFields): boolean {
  return isOpenEntry({
    isEntryList: m.isEntryList ?? false,
    tournamentId: m.tournamentId ?? null,
    bracketRound: m.bracketRound ?? null,
    parentMatchId: m.parentMatchId ?? null,
  });
}

export interface ScrimDay {
  key: string; // IST "YYYY-MM-DD"
  label: string; // "Today" | "Tomorrow" | "Mon"
  date: string; // "28 Sep"
}

export interface ScrimsQuery {
  game: Game | null;
  date: string;
  mode: MatchMode | null;
  fee: ScrimFee;
  prize: ScrimPrize;
  status: ScrimStatusFilter;
  q: string;
  sort: ScrimSort;
  view: "grid" | "calendar";
  /** Not in the URL: today's IST key, the default `date`. */
  today: string;
}

/** Today and the next three IST days (the page's window). */
export function scrimDays(now: Date): ScrimDay[] {
  return [0, 1, 2, 3].map((i) => {
    const d = addDays(now, i);
    return {
      key: istDayKey(d),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : shortWeekdayIST(d),
      date: shortDateIST(d),
    };
  });
}

type RawParams = Record<string, string | string[] | undefined>;

function one(sp: RawParams, key: string): string | null {
  const v = sp[key];
  return typeof v === "string" ? v : null;
}

function pick<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickOrNull<T extends string>(allowed: readonly T[], value: string | null): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Modes the Mode filter offers: the selected game's modes, or every mode when no game is chosen. */
export function modesFor(game: Game | null): readonly MatchMode[] {
  return game ? MODES_FOR_GAME[game] : MATCH_MODES;
}

/** Unknown or malformed values fall back to defaults, so any URL renders. */
export function parseScrimsQuery(sp: RawParams, now: Date): ScrimsQuery {
  const days = scrimDays(now);
  const today = days[0]!.key;
  // "today" / "tomorrow" are accepted as aliases (e.g. the home page's "see tomorrow's scrims" link).
  const raw = one(sp, "date");
  const date = raw === "today" ? today : raw === "tomorrow" ? days[1]!.key : raw;
  const game = gameFromSlug(one(sp, "game"));
  return {
    game,
    date: days.some((d) => d.key === date) ? date! : today,
    // A mode the selected game doesn't have (e.g. Squad for Valorant) is dropped.
    mode: pickOrNull(modesFor(game), one(sp, "mode")),
    fee: pick(SCRIM_FEES, one(sp, "fee"), "all"),
    prize: pick(SCRIM_PRIZES, one(sp, "prize"), "all"),
    status: pick(SCRIM_STATUSES, one(sp, "status"), "all"),
    q: (one(sp, "q") ?? "").trim().replace(/\s+/g, " ").slice(0, 64),
    sort: pick(SCRIM_SORTS, one(sp, "sort"), "start"),
    view: one(sp, "view") === "calendar" ? "calendar" : "grid",
    today,
  };
}

/** /scrims URL for `query` with `patch` applied; default values are left out. */
export function scrimsHref(
  query: ScrimsQuery,
  patch: Partial<Omit<ScrimsQuery, "today">> = {},
): string {
  const q = { ...query, ...patch };
  const p = new URLSearchParams();
  if (q.game) p.set("game", GAME_CONFIG[q.game].slug);
  if (q.date !== q.today) p.set("date", q.date);
  if (q.mode) p.set("mode", q.mode);
  if (q.fee !== "all") p.set("fee", q.fee);
  if (q.prize !== "all") p.set("prize", q.prize);
  if (q.status !== "all") p.set("status", q.status);
  if (q.q) p.set("q", q.q);
  if (q.sort !== "start") p.set("sort", q.sort);
  if (q.view !== "grid") p.set("view", q.view);
  const s = p.toString();
  return s ? `/scrims?${s}` : "/scrims";
}

/** Filters shown in the filter panel that differ from their default (for the mobile "Filters (n)" button). */
export function activeFilterCount(q: ScrimsQuery): number {
  return [
    q.mode !== null,
    q.fee !== "all",
    q.prize !== "all",
    q.status !== "all",
    q.q !== "",
  ].filter(Boolean).length;
}

export function isAlmostFull(filled: number, maxSlots: number): boolean {
  return maxSlots > 0 && filled < maxSlots && filled / maxSlots >= ALMOST_FULL_RATIO;
}

/**
 * The card's status pill, derived from the registration rules. UPCOMING (registration not open yet)
 * gets a grey pill. Paid matches while paid entry is switched off get none: their button already says
 * "Coming Soon" and they can't be joined.
 */
export function scrimStatus(
  m: ScrimFields,
  now: Date,
  paymentsEnabled: boolean,
): ScrimStatus | null {
  if (m.status === "LIVE") return "live";
  const paidEntryOff = m.entryFeePaise > 0 && !paymentsEnabled;
  if (m.status === "UPCOMING") return paidEntryOff ? null : "upcoming";
  const filled = m._count.registrations;
  const openEntry = scrimIsOpenEntry(m);
  const action = cardAction({ ...m, confirmedCount: filled, openEntry }, now, paymentsEnabled);
  if (action === "SOON" || action === "PAID_SOON") return null;
  if (action === "CLOSED") return "closed";
  if (action === "WAITLIST") return "waitlist";
  return !openEntry && isAlmostFull(filled, m.maxSlots) ? "almost-full" : "open";
}

/** "Opens at 5:30 PM" (today, IST) or "Opens 29 Sep, 5:30 PM"; null when unknown or already past. */
export function opensNote(opensAt: Date | null, now: Date): string | null {
  if (!opensAt || opensAt <= now) return null;
  const clock = formatClockIST(opensAt, { pad: false });
  return istDayKey(opensAt) === istDayKey(now)
    ? `Opens at ${clock}`
    : `Opens ${shortDateIST(opensAt)}, ${clock}`;
}

export interface ScrimPill {
  status: ScrimStatus;
  /** Small line under the pill (registration opening time for UPCOMING). */
  note: string | null;
}

/** What the card's top-right corner shows, or null for no pill. */
export function scrimPill(m: ScrimFields, now: Date, paymentsEnabled: boolean): ScrimPill | null {
  const status = scrimStatus(m, now, paymentsEnabled);
  if (!status) return null;
  return { status, note: status === "upcoming" ? opensNote(m.registrationOpensAt, now) : null };
}

function inPrizeBucket(prizePaise: number, bucket: ScrimPrize): boolean {
  if (bucket === "under-1k") return prizePaise < 1_000 * RUPEE;
  if (bucket === "1k-5k") return prizePaise >= 1_000 * RUPEE && prizePaise <= 5_000 * RUPEE;
  if (bucket === "over-5k") return prizePaise > 5_000 * RUPEE;
  return true;
}

/** Everything except the date: the page splits the result into the selected day and the days after it. */
export function filterScrims<T extends ScrimFields>(
  list: T[],
  q: ScrimsQuery,
  now: Date,
  paymentsEnabled: boolean,
): T[] {
  const needle = q.q.toLowerCase();
  return list.filter((m) => {
    if (q.game && m.game !== q.game) return false;
    if (q.mode && m.mode !== q.mode) return false;
    if (q.fee === "free" && m.entryFeePaise > 0) return false;
    if (q.fee === "paid" && m.entryFeePaise === 0) return false;
    if (!inPrizeBucket(m.prizePaise, q.prize)) return false;
    if (q.status !== "all" && scrimStatus(m, now, paymentsEnabled) !== q.status) return false;
    if (needle && !`${m.title} ${GAME_CONFIG[m.game].name}`.toLowerCase().includes(needle))
      return false;
    return true;
  });
}

const byStart = (a: ScrimFields, b: ScrimFields) => a.startsAt.getTime() - b.startsAt.getTime();
const slotsLeft = (m: ScrimFields) =>
  // Open entry never runs out of places: sorts first (a finite value so equal ones tie).
  scrimIsOpenEntry(m) ? Number.MAX_SAFE_INTEGER : Math.max(0, m.maxSlots - m._count.registrations);

/** Start time ascending; prize highest first; entry fee lowest first; most slots left first. Ties by start time. */
export function sortScrims<T extends ScrimFields>(list: T[], sort: ScrimSort): T[] {
  const cmp: Record<ScrimSort, (a: T, b: T) => number> = {
    start: byStart,
    prize: (a, b) => b.prizePaise - a.prizePaise || byStart(a, b),
    fee: (a, b) => a.entryFeePaise - b.entryFeePaise || byStart(a, b),
    slots: (a, b) => slotsLeft(b) - slotsLeft(a) || byStart(a, b),
  };
  return [...list].sort(cmp[sort]);
}

/** Group by IST day over the window (every day present, possibly empty). */
export function groupByDay<T extends ScrimFields>(list: T[], days: ScrimDay[]): Map<string, T[]> {
  const map = new Map<string, T[]>(days.map((d) => [d.key, []]));
  for (const m of list) map.get(istDayKey(m.startsAt))?.push(m);
  return map;
}

/** The first day after `afterKey` that has matches, for the "No scrims yet for this day" link. */
export function nextDayWithMatches<T>(
  days: ScrimDay[],
  afterKey: string,
  byDay: Map<string, T[]>,
): ScrimDay | null {
  return days.find((d) => d.key > afterKey && (byDay.get(d.key)?.length ?? 0) > 0) ?? null;
}

/** "Today's Scrims" / "Tomorrow's Scrims" / "Scrims on Mon, 29 Sep". */
export function dayHeading(day: ScrimDay): string {
  if (day.label === "Today") return "Today's Scrims";
  if (day.label === "Tomorrow") return "Tomorrow's Scrims";
  return `Scrims on ${day.label}, ${day.date}`;
}
