import { describe, expect, it } from "vitest";
import {
  brPoints,
  canReopenResults,
  defaultPointsConfig,
  duplicatePlacements,
  entriesPerPlacement,
  isWithinDisputeWindow,
  placementPoints,
  pointsForMatch,
  rankStandings,
  valorantPoints,
  type EntryForStanding,
} from "@/lib/points";

const br = defaultPointsConfig("BGMI");
const val = defaultPointsConfig("VALORANT");

describe("points table", () => {
  it.each([
    [1, 15],
    [2, 12],
    [3, 10],
    [4, 8],
    [5, 6],
    [6, 4],
    [7, 2],
    [8, 2],
    [9, 1],
    [12, 1],
    [13, 0],
    [25, 0],
  ])("placement %i scores %i", (placement, points) => {
    expect(placementPoints(br, placement)).toBe(points);
  });

  it("scores nothing for invalid placements", () => {
    expect(placementPoints(br, 0)).toBe(0);
    expect(placementPoints(br, -1)).toBe(0);
    expect(placementPoints(br, 1.5)).toBe(0);
  });

  it("adds 1 point per kill and doubles tournament matches", () => {
    expect(brPoints(br, { placement: 1, kills: 9 }, false)).toBe(24);
    expect(brPoints(br, { placement: 1, kills: 9 }, true)).toBe(48);
    expect(brPoints(br, { placement: 20, kills: 3 }, false)).toBe(3);
    expect(brPoints(br, { placement: 3, kills: -5 }, false)).toBe(10);
  });

  it("scores Valorant 3 for a win and 0 for a loss", () => {
    expect(valorantPoints(val, { won: true, roundDiff: 5 }, false)).toBe(3);
    expect(valorantPoints(val, { won: false, roundDiff: -5 }, false)).toBe(0);
    expect(valorantPoints(val, { won: true, roundDiff: 2 }, true)).toBe(6);
  });

  it("uses a configurable table", () => {
    const custom = { ...br, placementPoints: [20, 10], killPoints: 2 };
    expect(brPoints(custom, { placement: 2, kills: 4 }, false)).toBe(18);
  });
});

describe("team propagation", () => {
  it("gives every squad member the team's points, kills and win", () => {
    const rows = pointsForMatch("SQUAD", "SCRIM", br, [
      {
        registrationId: "r1",
        playerIds: ["a", "b", "c", "d"],
        placement: 1,
        kills: 12,
        won: null,
        roundDiff: null,
      },
      {
        registrationId: "r2",
        playerIds: ["e"],
        placement: 5,
        kills: 0,
        won: null,
        roundDiff: null,
      },
    ]);
    expect(rows).toHaveLength(5);
    expect(
      rows
        .filter((r) => ["a", "b", "c", "d"].includes(r.userId))
        .every((r) => r.points === 27 && r.kills === 12 && r.won),
    ).toBe(true);
    expect(rows.find((r) => r.userId === "e")).toMatchObject({
      points: 6,
      won: false,
      placement: 5,
      reason: "scrim",
    });
  });

  it("scores Valorant teams by win/loss with round difference", () => {
    const rows = pointsForMatch("FIVE_V_FIVE", "TOURNAMENT", val, [
      {
        registrationId: "r1",
        playerIds: ["a", "b"],
        placement: null,
        kills: null,
        won: true,
        roundDiff: 6,
      },
      {
        registrationId: "r2",
        playerIds: ["c"],
        placement: null,
        kills: null,
        won: false,
        roundDiff: -6,
      },
    ]);
    expect(rows.find((r) => r.userId === "a")).toMatchObject({
      points: 6,
      won: true,
      roundDiff: 6,
      reason: "tournament",
    });
    expect(rows.find((r) => r.userId === "c")).toMatchObject({
      points: 0,
      won: false,
      roundDiff: -6,
    });
  });

  it("scores battle royale head-to-head modes (Clash Squad, TDM) by win/loss too", () => {
    const rows = pointsForMatch("ONE_V_ONE", "SCRIM", br, [
      {
        registrationId: "r1",
        playerIds: ["a"],
        placement: null,
        kills: null,
        won: true,
        roundDiff: 3,
      },
      {
        registrationId: "r2",
        playerIds: ["b"],
        placement: null,
        kills: null,
        won: false,
        roundDiff: -3,
      },
    ]);
    expect(rows.find((r) => r.userId === "a")).toMatchObject({
      points: br.winPoints,
      won: true,
      placement: 1,
      kills: 0,
    });
    expect(rows.find((r) => r.userId === "b")).toMatchObject({
      points: br.lossPoints,
      won: false,
      placement: 2,
    });
  });
});

describe("conflicts", () => {
  it("finds placements claimed twice", () => {
    expect(duplicatePlacements([1, 2, 2, 3, 3, 3, null, null])).toEqual([2, 3]);
    expect(duplicatePlacements([1, 2, 3])).toEqual([]);
  });

  it("duo allows two entries (the partners) per placement", () => {
    expect(entriesPerPlacement("DUO")).toBe(2);
    expect(entriesPerPlacement("SOLO")).toBe(1);
    expect(entriesPerPlacement("SQUAD")).toBe(1);
    expect(duplicatePlacements([1, 1, 2, 2, 2, 3], 2)).toEqual([2]);
    expect(duplicatePlacements([1, 1, 2], entriesPerPlacement("DUO"))).toEqual([]);
  });
});

describe("standings and ties", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min));
  const e = (
    userId: string,
    points: number,
    kills: number,
    won: boolean,
    at: number,
    roundDiff = 0,
  ): EntryForStanding => ({
    userId,
    points,
    kills,
    won,
    roundDiff,
    createdAt: t(at),
  });

  it("orders by points", () => {
    const s = rankStandings("BGMI", [
      e("a", 10, 0, false, 1),
      e("b", 20, 0, false, 1),
      e("a", 5, 0, false, 2),
    ]);
    expect(s.map((r) => [r.userId, r.points, r.matches, r.rank])).toEqual([
      ["b", 20, 1, 1],
      ["a", 15, 2, 2],
    ]);
  });

  it("BR tiebreak: wins, then kills, then earlier achievement", () => {
    const byWins = rankStandings("FREE_FIRE", [
      e("a", 20, 5, false, 1),
      e("a", 0, 0, false, 2),
      e("b", 20, 1, true, 3),
    ]);
    expect(byWins.map((r) => r.userId)).toEqual(["b", "a"]);
    const byKills = rankStandings("BGMI", [e("a", 20, 3, true, 1), e("b", 20, 7, true, 5)]);
    expect(byKills.map((r) => r.userId)).toEqual(["b", "a"]);
    const byTime = rankStandings("BGMI", [e("late", 20, 3, true, 9), e("early", 20, 3, true, 2)]);
    expect(byTime.map((r) => [r.userId, r.rank])).toEqual([
      ["early", 1],
      ["late", 2],
    ]);
  });

  it("Valorant tiebreak: wins, then round difference", () => {
    const s = rankStandings("VALORANT", [
      e("a", 6, 0, true, 1, 3),
      e("a", 0, 0, false, 2, -2),
      e("b", 6, 0, true, 3, 4),
      e("b", 0, 0, false, 4, -1),
    ]);
    expect(s.map((r) => [r.userId, r.roundDiff])).toEqual([
      ["b", 3],
      ["a", 1],
    ]);
  });

  it("players tied on every tiebreaker share a rank", () => {
    const s = rankStandings("BGMI", [
      e("a", 10, 2, false, 1),
      e("b", 10, 2, false, 1),
      e("c", 5, 0, false, 1),
    ]);
    expect(s.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});

describe("dispute window", () => {
  const approved = new Date("2026-10-01T12:00:00Z");
  const after = (min: number) => new Date(approved.getTime() + min * 60_000);
  it("lets moderators reopen within 2 hours and admins any time", () => {
    expect(canReopenResults("MODERATOR", approved, after(119))).toBe(true);
    expect(canReopenResults("MODERATOR", approved, after(121))).toBe(false);
    expect(canReopenResults("ADMIN", approved, after(10_000))).toBe(true);
    expect(canReopenResults("PLAYER", approved, after(1))).toBe(false);
  });
  it("lets players dispute within 2 hours", () => {
    expect(isWithinDisputeWindow(approved, after(120))).toBe(true);
    expect(isWithinDisputeWindow(approved, after(121))).toBe(false);
    expect(isWithinDisputeWindow(null, after(1))).toBe(false);
  });
});
