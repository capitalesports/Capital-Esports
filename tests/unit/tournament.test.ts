import { describe, expect, it } from "vitest";
import {
  bracketPodium,
  bracketShape,
  entryCountLabel,
  nextRoundEntrants,
  pairRound,
  pickByMode,
  walkBracket,
  lobbyStandings,
  mondayOfIstWeek,
  roundName,
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
    expect(mondayOfIstWeek(new Date("2026-09-27T20:00:00Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(mondayOfIstWeek(new Date("2026-09-27T10:00:00Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
    expect(mondayOfIstWeek(new Date("2026-09-28T00:00:00Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
  });
});

describe("bracket with byes (DECISIONS M50)", () => {
  it("pairs in order and gives the odd one out a bye", () => {
    expect(pairRound(["A", "B", "C", "D"])).toEqual({
      pairs: [
        ["A", "B"],
        ["C", "D"],
      ],
      bye: null,
    });
    expect(pairRound(["A", "B", "C"])).toEqual({ pairs: [["A", "B"]], bye: "C" });
    expect(pairRound(["A"])).toEqual({ pairs: [], bye: "A" });
  });

  it("puts last round's bye first so it never gets two byes in a row", () => {
    expect(nextRoundEntrants(["W1", "W2"], "I")).toEqual(["I", "W1", "W2"]);
    expect(nextRoundEntrants(["W1", "W2"], null)).toEqual(["W1", "W2"]);
  });

  it("shapes a bracket for any number of teams", () => {
    expect(bracketShape(8).map((r) => [r.matches, r.byes])).toEqual([
      [4, 0],
      [2, 0],
      [1, 0],
    ]);
    // 9 teams: Team 9 skips round 1; round 2 has 5 teams, so another bye; and so on.
    expect(bracketShape(9).map((r) => [r.matches, r.byes])).toEqual([
      [4, 1],
      [2, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(bracketShape(3).map((r) => [r.matches, r.byes])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    expect(bracketShape(2)).toEqual([{ round: 1, matches: 1, byes: 0 }]);
    expect(bracketShape(1)).toEqual([]);
  });

  it("plays 9 teams to one champion and nobody gets two byes in a row", () => {
    const teams = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"];
    let entrants = teams;
    const byes: string[] = [];
    let rounds = 0;
    while (entrants.length > 1) {
      const { pairs, bye } = pairRound(entrants);
      if (bye) byes.push(bye);
      // The lower-numbered team always wins.
      const winners = pairs.map(([a, b]) => (Number(a.slice(1)) < Number(b.slice(1)) ? a : b));
      entrants = nextRoundEntrants(winners, bye);
      rounds++;
    }
    expect(entrants).toEqual(["T1"]);
    expect(rounds).toBe(bracketShape(9).length);
    expect(byes[0]).toBe("T9");
    for (let i = 1; i < byes.length; i++) expect(byes[i]).not.toBe(byes[i - 1]);
  });

  it("replays a bracket up to the round being played", () => {
    const wins: Record<string, string> = { "1:0": "A", "1:1": "D" };
    const rounds = walkBracket(["A", "B", "C", "D", "E"], (r, i) => wins[`${r}:${i}`] ?? null);
    expect(rounds.map((r) => [r.entrants.join(""), r.bye, r.complete])).toEqual([
      ["ABCDE", "E", true],
      ["EAD", "D", false],
    ]);
    // A "winner" outside the pair is ignored.
    expect(walkBracket(["A", "B"], () => "Z")[0]!.winners).toEqual([null]);
    expect(walkBracket(["A"], () => null)).toEqual([]);
  });

  it("names rounds", () => {
    expect(roundName(1, 3)).toBe("Quarterfinals");
    expect(roundName(2, 3)).toBe("Semifinals");
    expect(roundName(3, 3)).toBe("Final");
    expect(roundName(1, 4)).toBe("Round 1");
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
  const r = (
    unitKey: string,
    matchId: string,
    placement: number,
    kills: number,
    points: number,
  ): LobbyResult => ({
    unitKey,
    name: unitKey,
    matchId,
    placement,
    kills,
    points,
  });

  it("sums points across matches", () => {
    const s = lobbyStandings([
      r("a", "m1", 1, 5, 40),
      r("b", "m1", 2, 2, 28),
      r("a", "m2", 3, 1, 22),
      r("b", "m2", 1, 6, 42),
      r("c", "m3", 1, 0, 30),
    ]);
    expect(s.map((x) => [x.unitKey, x.points, x.matches, x.rank])).toEqual([
      ["b", 70, 2, 1],
      ["a", 62, 2, 2],
      ["c", 30, 1, 3],
    ]);
  });

  it("breaks ties by wins, kills, best placement and shares exact ties", () => {
    const s = lobbyStandings([
      r("a", "m1", 1, 0, 30),
      r("b", "m1", 2, 6, 30),
      r("c", "m2", 2, 6, 30),
    ]);
    expect(s.map((x) => [x.unitKey, x.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
    ]);
  });
});
