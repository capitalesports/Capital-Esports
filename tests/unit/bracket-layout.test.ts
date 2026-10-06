import { describe, expect, it } from "vitest";
import { bracketLayout } from "@/lib/bracket-layout";
import { bracketShape } from "@/lib/tournament";

const ys = (n: number) =>
  bracketLayout(bracketShape(n)).columns.map((c) => c.items.map((i) => `${i.kind[0]}${i.y}`));

describe("bracket layout (DECISIONS M50)", () => {
  it("centres each match between the two it comes from", () => {
    expect(ys(8)).toEqual([["m0", "m1", "m2", "m3"], ["m0.5", "m2.5"], ["m1.5"]]);
    const { edges, height } = bracketLayout(bracketShape(8));
    expect(edges).toHaveLength(6);
    expect(edges[0]).toEqual({ fromCol: 0, fromY: 0, toY: 0.5 });
    expect(height).toBe(4);
  });

  it("puts round 1's bye on top and never overlaps cards", () => {
    const { columns, edges } = bracketLayout(bracketShape(9));
    expect(columns[0]!.items.map((i) => `${i.kind}${i.y}`)).toEqual([
      "bye0",
      "match1",
      "match2",
      "match3",
      "match4",
    ]);
    // Round 2: bye + winner of match 1 → 0.5; matches 2+3 → 2.5; the bye is match 4's winner.
    expect(columns[1]!.items.map((i) => `${i.kind}${i.y}`)).toEqual([
      "match0.5",
      "match2.5",
      "bye4",
    ]);
    for (const c of columns)
      for (let k = 1; k < c.items.length; k++)
        expect(c.items[k]!.y - c.items[k - 1]!.y).toBeGreaterThanOrEqual(1);
    // Every card after round 1 has a line in: 2 per match, 1 per bye.
    expect(edges).toHaveLength(2 * 2 + 1 + 2 + 1 + 2);
  });

  it("handles 2 teams and nothing", () => {
    expect(ys(2)).toEqual([["m0"]]);
    expect(bracketLayout([])).toEqual({ columns: [], edges: [], height: 0 });
  });
});
