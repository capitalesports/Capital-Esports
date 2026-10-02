import { describe, expect, it } from "vitest";
import {
  bracketPodium,
  entryCountLabel,
  firstRoundPairs,
  pickByMode,
  lobbyStandings,
  mondayOfIstWeek,
  nextSlot,
  roundCount,
  roundName,
  seedOrder,
  siblingIndex,
  type LobbyResult,
} from "@/lib/tournament";

describe("tournament page helpers", () => {
  it("labels the entry count by mode", () => {
    expect(entryCountLabel("SOLO")).toBe("Players");
    expect(entryCountLabel("DUO")).toBe("Players");
    expect(entryCountLabel("ONE_V_ONE")).toBe("Players");
    expect(entryCountLabel("SQUAD")).toBe("Squads");
    expect(entryCountLabel("FIVE_V_FIVE")).toBe("Teams");
    expect(entryCountLabel("TWO_V_TWO")).toBe("Teams");
  });

  it("picks the tournament for ?mode=, falling back to the first", () => {
    const list = [
      { id: "a", mode: "SOLO" as const },
      { id: "b", mode: "ONE_V_ONE" as const },
    ];
    expect(pickByMode(list, "ONE_V_ONE")?.id).toBe("b");
    expect(pickByMode(list, ["ONE_V_ONE", "SOLO"])?.id).toBe("b");
    expect(pickByMode(list, "SQUAD")?.id).toBe("a");
    expect(pickByMode(list, "nonsense")?.id).toBe("a");
    expect(pickByMode(list, undefined)?.id).toBe("a");
    expect(pickByMode([], "SOLO")).toBeUndefined();
  });
});

describe("mondayOfIstWeek", () => {
  it("returns the IST Monday", () => {
    // Sunday 27 Sep 2026 20:00 UTC is Monday 28 Sep 01:30 IST.
    expect(mondayOfIstWeek(new Date("2026-09-27T20:00:00Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(mondayOfIstWeek(new Date("2026-09-27T10:00:00Z")).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(mondayOfIstWeek(new Date("2026-09-28T00:00:00Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
});

describe("bracket generation", () => {
  it("seeds 8 and 16 team brackets so top seeds meet late", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it("pairs 8 teams into 4 first-round matches", () => {
    const teams = ["A", "B", "C", "D", "E", "F", "G", "H"];
    expect(firstRoundPairs(teams)).toEqual([
      ["A", "H"],
      ["D", "E"],
      ["B", "G"],
      ["C", "F"],
    ]);
    expect(roundCount(8)).toBe(3);
  });

  it("pairs 16 teams into 8 first-round matches with every team once", () => {
    const teams = Array.from({ length: 16 }, (_, i) => `T${i + 1}`);
    const pairs = firstRoundPairs(teams);
    expect(pairs).toHaveLength(8);
    expect(new Set(pairs.flat()).size).toBe(16);
    expect(pairs[0]).toEqual(["T1", "T16"]);
    expect(roundCount(16)).toBe(4);
  });

  it("rejects other sizes", () => {
    expect(() => firstRoundPairs(["A", "B", "C", "D"])).toThrow();
    expect(() => firstRoundPairs(Array.from({ length: 10 }, (_, i) => i))).toThrow();
  });
});

describe("bracket advancement", () => {
  it("sends winners to the right next-round slot", () => {
    expect(nextSlot(1, 0)).toEqual({ round: 2, index: 0, side: 0 });
    expect(nextSlot(1, 1)).toEqual({ round: 2, index: 0, side: 1 });
    expect(nextSlot(1, 6)).toEqual({ round: 2, index: 3, side: 0 });
    expect(nextSlot(3, 1)).toEqual({ round: 4, index: 0, side: 1 });
    expect(siblingIndex(4)).toBe(5);
    expect(siblingIndex(5)).toBe(4);
  });

  it("simulates an 8-team bracket to a single champion", () => {
    const pairs = firstRoundPairs(["A", "B", "C", "D", "E", "F", "G", "H"]);
    // Higher seed (earlier letter) always wins.
    let round = pairs.map(([a, b]) => (a < b ? a : b));
    const rounds = [round];
    while (round.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < round.length; i += 2) next.push(round[i]! < round[i + 1]! ? round[i]! : round[i + 1]!);
      round = next;
      rounds.push(round);
    }
    expect(rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(rounds[1]).toEqual(["A", "B"]);
    expect(rounds[2]).toEqual(["A"]);
  });

  it("names rounds", () => {
    expect(roundName(1, 3)).toBe("Quarterfinals");
    expect(roundName(2, 3)).toBe("Semifinals");
    expect(roundName(3, 3)).toBe("Final");
    expect(roundName(1, 4)).toBe("Round of 16");
  });

  it("derives the podium", () => {
    expect(
      bracketPodium(
        [
          { round: 3, index: 0, winnerKey: "A", loserKey: "B", loserRoundDiff: -2 },
          { round: 2, index: 0, winnerKey: "A", loserKey: "D", loserRoundDiff: -8 },
          { round: 2, index: 1, winnerKey: "B", loserKey: "C", loserRoundDiff: -1 },
        ],
        3,
      ),
    ).toEqual(["A", "B", "C"]);
    expect(bracketPodium([], 3)).toEqual([]);
  });
});

describe("lobby points standings", () => {
  const r = (unitKey: string, matchId: string, placement: number, kills: number, points: number): LobbyResult => ({
    unitKey,
    name: unitKey,
    matchId,
    placement,
    kills,
    points,
  });

  it("sums points across matches", () => {
    const s = lobbyStandings([r("a", "m1", 1, 5, 40), r("b", "m1", 2, 2, 28), r("a", "m2", 3, 1, 22), r("b", "m2", 1, 6, 42), r("c", "m3", 1, 0, 30)]);
    expect(s.map((x) => [x.unitKey, x.points, x.matches, x.rank])).toEqual([
      ["b", 70, 2, 1],
      ["a", 62, 2, 2],
      ["c", 30, 1, 3],
    ]);
  });

  it("breaks ties by wins, kills, best placement and shares exact ties", () => {
    const s = lobbyStandings([r("a", "m1", 1, 0, 30), r("b", "m1", 2, 6, 30), r("c", "m2", 2, 6, 30)]);
    expect(s.map((x) => [x.unitKey, x.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
    ]);
  });
});
