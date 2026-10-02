import { describe, expect, it } from "vitest";
import {
  canTransition,
  dueTransition,
  expectedEndAt,
  isEditable,
  MATCH_STATUSES,
  type MatchStatus,
  type ScheduledMatch,
} from "@/lib/match-state";

/** The spec's transitions plus the documented cancel extensions (DECISIONS D2.1). */
const LEGAL: [MatchStatus, MatchStatus][] = [
  ["UPCOMING", "REGISTRATION_OPEN"],
  ["UPCOMING", "CANCELLED"],
  ["REGISTRATION_OPEN", "REGISTRATION_CLOSED"],
  ["REGISTRATION_OPEN", "CANCELLED"],
  ["REGISTRATION_CLOSED", "LIVE"],
  ["REGISTRATION_CLOSED", "CANCELLED"],
  ["LIVE", "RESULTS_PENDING"],
  ["LIVE", "CANCELLED"],
  ["RESULTS_PENDING", "COMPLETED"],
  ["COMPLETED", "RESULTS_PENDING"],
];

const isLegal = (from: MatchStatus, to: MatchStatus) => LEGAL.some(([f, t]) => f === from && t === to);

describe("match state machine", () => {
  const pairs = MATCH_STATUSES.flatMap((from) => MATCH_STATUSES.map((to) => [from, to] as const));

  it.each(pairs.filter(([f, t]) => isLegal(f, t)))("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(pairs.filter(([f, t]) => !isLegal(f, t)))("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("covers all 49 pairs", () => {
    expect(pairs).toHaveLength(49);
  });

  it("never leaves CANCELLED and never skips straight to COMPLETED", () => {
    for (const to of MATCH_STATUSES) expect(canTransition("CANCELLED", to)).toBe(false);
    for (const from of MATCH_STATUSES.filter((s) => s !== "RESULTS_PENDING")) {
      expect(canTransition(from, "COMPLETED")).toBe(false);
    }
  });

  it("allows editing only before the match starts", () => {
    expect(isEditable("UPCOMING")).toBe(true);
    expect(isEditable("REGISTRATION_CLOSED")).toBe(true);
    expect(isEditable("LIVE")).toBe(false);
    expect(isEditable("CANCELLED")).toBe(false);
  });
});

describe("dueTransition (cron)", () => {
  const start = new Date("2026-10-01T15:30:00Z");
  const base: ScheduledMatch = {
    game: "BGMI",
    status: "UPCOMING",
    startsAt: start,
    registrationOpensAt: new Date("2026-10-01T10:00:00Z"),
    registrationClosesAt: new Date("2026-10-01T15:00:00Z"),
  };
  const at = (iso: string) => new Date(iso);

  it("opens registration at the configured time", () => {
    expect(dueTransition(base, at("2026-10-01T09:59:00Z"))).toBeNull();
    expect(dueTransition(base, at("2026-10-01T10:00:00Z"))).toBe("REGISTRATION_OPEN");
  });

  it("does not auto-open without an open time", () => {
    expect(dueTransition({ ...base, registrationOpensAt: null }, at("2026-10-01T12:00:00Z"))).toBeNull();
  });

  it("closes registration at registrationClosesAt", () => {
    const m = { ...base, status: "REGISTRATION_OPEN" as const };
    expect(dueTransition(m, at("2026-10-01T14:59:59Z"))).toBeNull();
    expect(dueTransition(m, at("2026-10-01T15:00:00Z"))).toBe("REGISTRATION_CLOSED");
  });

  it("goes live at startsAt", () => {
    const m = { ...base, status: "REGISTRATION_CLOSED" as const };
    expect(dueTransition(m, at("2026-10-01T15:29:00Z"))).toBeNull();
    expect(dueTransition(m, start)).toBe("LIVE");
  });

  it("moves to results pending after the game's match length", () => {
    expect(expectedEndAt({ game: "FREE_FIRE", startsAt: start }).toISOString()).toBe("2026-10-01T15:50:00.000Z");
    expect(expectedEndAt({ game: "BGMI", startsAt: start }).toISOString()).toBe("2026-10-01T16:00:00.000Z");
    expect(expectedEndAt({ game: "VALORANT", startsAt: start }).toISOString()).toBe("2026-10-01T16:30:00.000Z");
    const m = { ...base, status: "LIVE" as const };
    expect(dueTransition(m, at("2026-10-01T15:59:00Z"))).toBeNull();
    expect(dueTransition(m, at("2026-10-01T16:00:00Z"))).toBe("RESULTS_PENDING");
  });

  it("never moves results, completed or cancelled matches", () => {
    const later = at("2027-01-01T00:00:00Z");
    for (const status of ["RESULTS_PENDING", "COMPLETED", "CANCELLED"] as const) {
      expect(dueTransition({ ...base, status }, later)).toBeNull();
    }
  });
});
