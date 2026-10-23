import { describe, expect, it } from "vitest";
import { bracketLayout } from "@/lib/bracket-layout";
import { bracketSlots, readyBracketPairs, walkBracket } from "@/lib/tournament";

// Clash Squad Cup #1: 9 teams, so 4 round-1 games and a bye (UNION, last in sign-up order).
const teams = ["OVR", "YUVI", "BLOOD", "NW", "RUSH", "ELITE", "NV", "MRK", "UNION"];
const decided: Record<string, string> = {
  "1:0": "YUVI",
  "1:1": "NW",
  "1:2": "ELITE",
  "2:0": "UNION",
};
const winnerOf = (r: number, i: number) => decided[`${r}:${i}`] ?? null;
// Round 1, game 4 (NV vs MRK) cancelled: both teams disqualified.
const isVoid = (r: number, i: number) => r === 1 && i === 3;

describe("void bracket games (DECISIONS M73)", () => {
  it("drop the empty branch: round 1, semifinals, final", () => {
    const slots = bracketSlots(teams, winnerOf, isVoid);
    expect(slots).toEqual([teams, ["UNION", "YUVI", "NW", "ELITE"], ["UNION", null]]);
    // Without the void the same bracket had a TBD branch and four rounds.
    expect(bracketSlots(teams, winnerOf)).toHaveLength(4);
  });

  it("keep the games already played in place and never re-create the void one", () => {
    const ready = readyBracketPairs(teams, winnerOf, isVoid).map((p) => `${p.round}:${p.index}`);
    expect(ready).toEqual(["1:0", "1:1", "1:2", "2:0", "2:1"]);
    const rounds = walkBracket(teams, winnerOf, isVoid);
    expect(rounds[0]).toMatchObject({ complete: true, voided: [false, false, false, true] });
    expect(rounds[1]!.pairs).toEqual([
      ["UNION", "YUVI"],
      ["NW", "ELITE"],
    ]);
  });

  it("draw no card for a void game and join the rest correctly", () => {
    const { columns, edges } = bracketLayout([
      { matches: 4, byes: 1, voids: [3] },
      { matches: 2, byes: 0 },
      { matches: 1, byes: 0 },
    ]);
    expect(columns[0]!.items.map((i) => `${i.kind}${i.index}`)).toEqual([
      "bye0",
      "match0",
      "match1",
      "match2",
    ]);
    // Bye + game 1 feed semifinal 1; games 2 and 3 feed semifinal 2.
    expect(edges.filter((e) => e.fromCol === 0)).toHaveLength(4);
    expect(columns[1]!.items).toHaveLength(2);
  });
});
