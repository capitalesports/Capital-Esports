import { describe, expect, it } from "vitest";
import {
  ALMOST_FULL_RATIO,
  activeFilterCount,
  dayHeading,
  filterScrims,
  groupByDay,
  isAlmostFull,
  modesFor,
  nextDayWithMatches,
  parseScrimsQuery,
  scrimDays,
  opensNote,
  scrimPill,
  scrimIsOpenEntry,
  scrimStatus,
  scrimsHref,
  sortScrims,
  type ScrimFields,
} from "@/lib/scrims-filter";
import { formatClockIST, shortDateIST, shortWeekdayIST } from "@/lib/time";

// Sunday 27 Sep 2026, 17:30 IST
const NOW = new Date("2026-09-27T12:00:00Z");
const ist = (day: string, hhmm: string) => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() - 330 * 60_000);

let n = 0;
function scrim(p: Partial<ScrimFields> & { filled?: number; id?: string } = {}): ScrimFields & { id: string } {
  const startsAt = p.startsAt ?? ist("2026-09-27", "21:00");
  return {
    id: p.id ?? `m${++n}`,
    game: p.game ?? "FREE_FIRE",
    mode: p.mode ?? "SQUAD",
    title: p.title ?? "Evening Scrim",
    startsAt,
    status: p.status ?? "REGISTRATION_OPEN",
    registrationOpensAt: p.registrationOpensAt ?? null,
    registrationClosesAt: p.registrationClosesAt ?? new Date(startsAt.getTime() - 30 * 60_000),
    entryFeePaise: p.entryFeePaise ?? 0,
    prizePaise: p.prizePaise ?? 0,
    maxSlots: p.maxSlots ?? 12,
    _count: { registrations: p.filled ?? 0 },
    // Capacity rules (almost full, waitlist) apply to tournament matches; pass null for an
    // open-entry scrim, which never fills (DECISIONS M11).
    tournamentId: p.tournamentId === undefined ? "t1" : p.tournamentId,
  };
}

const q = (params: Record<string, string> = {}) => parseScrimsQuery(params, NOW);

describe("IST date window and formatting", () => {
  it("builds Today, Tomorrow, then weekday + date from the current IST day", () => {
    expect(scrimDays(NOW)).toEqual([
      { key: "2026-09-27", label: "Today", date: "27 Sep" },
      { key: "2026-09-28", label: "Tomorrow", date: "28 Sep" },
      { key: "2026-09-29", label: "Tue", date: "29 Sep" },
      { key: "2026-09-30", label: "Wed", date: "30 Sep" },
    ]);
  });

  it("rolls over at IST midnight, not UTC midnight", () => {
    const lateIst = new Date("2026-09-27T19:00:00Z"); // 00:30 IST on the 28th
    expect(scrimDays(lateIst)[0]).toEqual({ key: "2026-09-28", label: "Today", date: "28 Sep" });
  });

  it("formats the card clock and dates like the design", () => {
    expect(formatClockIST(ist("2026-09-27", "18:00"))).toBe("06:00 PM");
    expect(formatClockIST(ist("2026-09-27", "00:05"))).toBe("12:05 AM");
    expect(formatClockIST(ist("2026-09-27", "12:30"))).toBe("12:30 PM");
    expect(shortDateIST(ist("2026-09-28", "10:00"))).toBe("28 Sep");
    expect(shortWeekdayIST(ist("2026-09-28", "10:00"))).toBe("Mon");
  });

  it("titles the selected day's section", () => {
    const [today, tomorrow, third] = scrimDays(NOW);
    expect(dayHeading(today!)).toBe("Today's Scrims");
    expect(dayHeading(tomorrow!)).toBe("Tomorrow's Scrims");
    expect(dayHeading(third!)).toBe("Scrims on Tue, 29 Sep");
  });
});

describe("URL query parsing", () => {
  it("defaults everything for a bare /scrims", () => {
    expect(q()).toEqual({ game: null, date: "2026-09-27", mode: null, fee: "all", prize: "all", status: "all", q: "", sort: "start", view: "grid", today: "2026-09-27" });
  });

  it("reads valid values and ignores junk", () => {
    const parsed = q({ game: "bgmi", date: "2026-09-29", mode: "DUO", fee: "paid", prize: "1k-5k", status: "almost-full", q: "  night   scrim ", sort: "prize", view: "calendar" });
    expect(parsed).toMatchObject({ game: "BGMI", date: "2026-09-29", mode: "DUO", fee: "paid", prize: "1k-5k", status: "almost-full", q: "night scrim", sort: "prize", view: "calendar" });
    expect(q({ game: "fortnite", date: "2027-01-01", mode: "TRIO", fee: "x", prize: "lots", status: "maybe", sort: "random", view: "list" })).toEqual(q());
    expect(q({ date: "2026-10-01" }).date).toBe("2026-09-27"); // outside the 4-day window
    expect(q({ date: "tomorrow" }).date).toBe("2026-09-28");
    expect(q({ date: "today" }).date).toBe("2026-09-27");
    expect(q({ q: "x".repeat(200) }).q).toHaveLength(64);
  });

  it("only accepts modes the selected game has", () => {
    expect(modesFor(null)).toHaveLength(7);
    expect(modesFor("VALORANT")).toEqual(["ONE_V_ONE", "TWO_V_TWO", "FIVE_V_FIVE", "SOLO"]);
    expect(modesFor("BGMI")).toContain("FOUR_V_FOUR");
    expect(modesFor("BGMI")).not.toContain("FIVE_V_FIVE");
    expect(q({ game: "valorant", mode: "SQUAD" }).mode).toBeNull();
    expect(q({ game: "valorant", mode: "FIVE_V_FIVE" }).mode).toBe("FIVE_V_FIVE");
    expect(q({ game: "free-fire", mode: "FIVE_V_FIVE" }).mode).toBeNull();
    expect(q({ game: "free-fire", mode: "FOUR_V_FOUR" }).mode).toBe("FOUR_V_FOUR");
    expect(q({ mode: "SQUAD" }).mode).toBe("SQUAD");
  });

  it("round-trips through scrimsHref, leaving defaults out", () => {
    const parsed = q({ game: "valorant", date: "2026-09-28", fee: "free", sort: "slots" });
    const href = scrimsHref(parsed);
    expect(href).toBe("/scrims?game=valorant&date=2026-09-28&fee=free&sort=slots");
    expect(parseScrimsQuery(Object.fromEntries(new URL(href, "http://x").searchParams), NOW)).toEqual(parsed);
    expect(scrimsHref(q())).toBe("/scrims");
    expect(scrimsHref(parsed, { game: null, date: "2026-09-27" })).toBe("/scrims?fee=free&sort=slots");
  });

  it("counts active panel filters for the mobile Filters button", () => {
    expect(activeFilterCount(q())).toBe(0);
    expect(activeFilterCount(q({ game: "bgmi", date: "2026-09-28", sort: "fee" }))).toBe(0);
    expect(activeFilterCount(q({ mode: "SOLO", fee: "free", q: "rush" }))).toBe(3);
  });
});

describe("ALMOST FULL threshold", () => {
  it("starts at 80% of slots and stops when full", () => {
    expect(ALMOST_FULL_RATIO).toBe(0.8);
    expect(isAlmostFull(7, 10)).toBe(false);
    expect(isAlmostFull(8, 10)).toBe(true);
    expect(isAlmostFull(38, 48)).toBe(false); // 79.2%
    expect(isAlmostFull(39, 48)).toBe(true); // 81.25%
    expect(isAlmostFull(10, 10)).toBe(false);
    expect(isAlmostFull(0, 0)).toBe(false);
  });

  it("derives each card status from the registration rules", () => {
    expect(scrimStatus(scrim({ filled: 3 }), NOW, true)).toBe("open");
    expect(scrimStatus(scrim({ filled: 10 }), NOW, true)).toBe("almost-full");
    expect(scrimStatus(scrim({ filled: 12 }), NOW, true)).toBe("waitlist");
    expect(scrimStatus(scrim({ status: "LIVE" }), NOW, true)).toBe("live");
    expect(scrimStatus(scrim({ status: "REGISTRATION_CLOSED" }), NOW, true)).toBe("closed");
    expect(scrimStatus(scrim({ registrationClosesAt: new Date(NOW.getTime() - 1) }), NOW, true)).toBe("closed");
    expect(scrimStatus(scrim({ status: "UPCOMING" }), NOW, true)).toBe("upcoming");
    expect(scrimStatus(scrim({ entryFeePaise: 5000 }), NOW, false)).toBeNull(); // paid entry switched off
  });

  it("never shows an open-entry scrim as almost full or waitlist: more lobbies open instead", () => {
    const open = (filled: number) => scrim({ tournamentId: null, filled });
    expect(scrimIsOpenEntry(open(0))).toBe(true);
    expect(scrimStatus(open(10), NOW, true)).toBe("open");
    expect(scrimStatus(open(40), NOW, true)).toBe("open");
    expect(sortScrims([scrim({ id: "full", filled: 12 }), open(40)], "slots")[1]!.id).toBe("full");
  });
});

describe("filtering (URL query → list)", () => {
  const list = [
    scrim({ id: "ff-free", game: "FREE_FIRE", mode: "SQUAD", title: "Daily Scrims #245", prizePaise: 1_000_00 }),
    scrim({ id: "bgmi-paid", game: "BGMI", mode: "SQUAD", title: "Evening Scrims", entryFeePaise: 100_00, prizePaise: 2_000_00, filled: 13, maxSlots: 16 }),
    scrim({ id: "val-big", game: "VALORANT", mode: "FIVE_V_FIVE", title: "Competitive Scrims", entryFeePaise: 150_00, prizePaise: 6_000_00, status: "LIVE" }),
    scrim({ id: "ff-duo", game: "FREE_FIRE", mode: "DUO", title: "Late Night Scrims", prizePaise: 500_00, filled: 12 }),
  ];
  const ids = (params: Record<string, string>) => filterScrims(list, q(params), NOW, true).map((m) => m.id);

  it("filters by game, mode and entry fee", () => {
    expect(ids({ game: "free-fire" })).toEqual(["ff-free", "ff-duo"]);
    expect(ids({ mode: "SQUAD" })).toEqual(["ff-free", "bgmi-paid"]);
    expect(ids({ fee: "free" })).toEqual(["ff-free", "ff-duo"]);
    expect(ids({ fee: "paid" })).toEqual(["bgmi-paid", "val-big"]);
  });

  it("filters by prize pool bucket (₹1,000 and ₹5,000 fall in the middle bucket)", () => {
    expect(ids({ prize: "under-1k" })).toEqual(["ff-duo"]);
    expect(ids({ prize: "1k-5k" })).toEqual(["ff-free", "bgmi-paid"]);
    expect(ids({ prize: "over-5k" })).toEqual(["val-big"]);
  });

  it("filters by derived status", () => {
    expect(ids({ status: "open" })).toEqual(["ff-free"]);
    expect(ids({ status: "almost-full" })).toEqual(["bgmi-paid"]);
    expect(ids({ status: "waitlist" })).toEqual(["ff-duo"]);
    expect(ids({ status: "live" })).toEqual(["val-big"]);
    expect(ids({ status: "closed" })).toEqual([]);
  });

  it("searches titles and game names, case-insensitively, and combines filters", () => {
    expect(ids({ q: "night" })).toEqual(["ff-duo"]);
    expect(ids({ q: "valorant" })).toEqual(["val-big"]);
    expect(ids({ game: "free-fire", fee: "free", mode: "DUO" })).toEqual(["ff-duo"]);
    expect(ids({ game: "bgmi", q: "night" })).toEqual([]);
  });
});

describe("sorting", () => {
  const a = scrim({ id: "a", startsAt: ist("2026-09-27", "18:00"), prizePaise: 1_000_00, entryFeePaise: 50_00, filled: 32, maxSlots: 48 });
  const b = scrim({ id: "b", startsAt: ist("2026-09-27", "20:00"), prizePaise: 2_000_00, entryFeePaise: 100_00, filled: 40, maxSlots: 64 });
  const c = scrim({ id: "c", startsAt: ist("2026-09-27", "21:00"), prizePaise: 3_000_00, entryFeePaise: 0, filled: 9, maxSlots: 10 });
  const d = scrim({ id: "d", startsAt: ist("2026-09-27", "23:00"), prizePaise: 500_00, entryFeePaise: 30_00, filled: 12, maxSlots: 50 });
  const order = (sort: "start" | "prize" | "fee" | "slots") => sortScrims([d, b, c, a], sort).map((m) => m.id);

  it("sorts by start time, prize (high first), entry fee (low first) and slots left (most first)", () => {
    expect(order("start")).toEqual(["a", "b", "c", "d"]);
    expect(order("prize")).toEqual(["c", "b", "a", "d"]);
    expect(order("fee")).toEqual(["c", "d", "a", "b"]);
    expect(order("slots")).toEqual(["d", "b", "a", "c"]);
  });

  it("breaks ties by start time and never mutates the input", () => {
    const early = scrim({ id: "early", startsAt: ist("2026-09-27", "18:00"), prizePaise: 100 });
    const late = scrim({ id: "late", startsAt: ist("2026-09-27", "22:00"), prizePaise: 100 });
    const input = [late, early];
    expect(sortScrims(input, "prize").map((m) => m.id)).toEqual(["early", "late"]);
    expect(input.map((m) => m.id)).toEqual(["late", "early"]);
  });
});

describe("day grouping and the empty-day link", () => {
  const days = scrimDays(NOW);
  const byDay = groupByDay(
    [scrim({ id: "today", startsAt: ist("2026-09-27", "21:00") }), scrim({ id: "wed", startsAt: ist("2026-09-30", "20:00") }), scrim({ id: "later", startsAt: ist("2026-10-05", "20:00") })],
    days,
  );

  it("groups into every day of the window, dropping anything outside it", () => {
    expect([...byDay.keys()]).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(byDay.get("2026-09-27")!.map((m) => m.id)).toEqual(["today"]);
    expect(byDay.get("2026-09-28")).toEqual([]);
  });

  it("points an empty day at the next day that has matches", () => {
    expect(nextDayWithMatches(days, "2026-09-28", byDay)?.key).toBe("2026-09-30");
    expect(nextDayWithMatches(days, "2026-09-30", byDay)).toBeNull();
  });
});

describe("status pill mapping", () => {
  const opensNow = ist("2026-09-27", "17:30"); // exactly NOW (17:30 IST)
  const later = ist("2026-09-27", "19:45");
  const tomorrow = ist("2026-09-28", "17:30");

  it("maps every card state to its pill", () => {
    const pill = (p: Parameters<typeof scrim>[0], payments = true) => scrimPill(scrim(p), NOW, payments);
    expect(pill({ filled: 3 })).toEqual({ status: "open", note: null });
    expect(pill({ filled: 10 })).toEqual({ status: "almost-full", note: null });
    expect(pill({ filled: 12 })).toEqual({ status: "waitlist", note: null });
    expect(pill({ status: "REGISTRATION_CLOSED" })).toEqual({ status: "closed", note: null });
    expect(pill({ status: "COMPLETED" })).toEqual({ status: "closed", note: null });
    expect(pill({ status: "LIVE" })).toEqual({ status: "live", note: null });
    expect(pill({ status: "UPCOMING", registrationOpensAt: later })).toEqual({ status: "upcoming", note: "Opens at 7:45 PM" });
  });

  it("shows UPCOMING with the IST opening time, dated when it isn't today", () => {
    expect(scrimPill(scrim({ status: "UPCOMING", registrationOpensAt: tomorrow }), NOW, true)).toEqual({ status: "upcoming", note: "Opens 28 Sep, 5:30 PM" });
    expect(opensNote(later, NOW)).toBe("Opens at 7:45 PM");
    expect(opensNote(ist("2026-09-27", "23:05"), NOW)).toBe("Opens at 11:05 PM");
  });

  it("drops the note when the opening time is unknown or already past", () => {
    expect(scrimPill(scrim({ status: "UPCOMING" }), NOW, true)).toEqual({ status: "upcoming", note: null });
    expect(opensNote(opensNow, NOW)).toBeNull(); // not in the future
    expect(opensNote(ist("2026-09-27", "09:00"), NOW)).toBeNull();
  });

  it("keeps paid matches pill-less while paid entry is switched off, even before registration opens", () => {
    expect(scrimPill(scrim({ entryFeePaise: 50_00 }), NOW, false)).toBeNull();
    expect(scrimPill(scrim({ entryFeePaise: 50_00, status: "UPCOMING", registrationOpensAt: later }), NOW, false)).toBeNull();
    expect(scrimPill(scrim({ entryFeePaise: 50_00, status: "UPCOMING", registrationOpensAt: later }), NOW, true)).toEqual({ status: "upcoming", note: "Opens at 7:45 PM" });
    expect(scrimPill(scrim({ entryFeePaise: 50_00, status: "LIVE" }), NOW, false)).toEqual({ status: "live", note: null });
  });

  it("cannot be selected in the Status filter (not one of its options)", () => {
    expect(q({ status: "upcoming" }).status).toBe("all");
  });
});
