import { describe, expect, it } from "vitest";
import { matchReadRows, nameSimilarity, normalizeName } from "@/lib/result-matching";

describe("normalizeName", () => {
  it("folds Free Fire style names to plain letters and digits", () => {
    expect(normalizeName("꧁ᴀʟᴘʜᴀ꧂")).toBe("alpha");
    expect(normalizeName("XB Yuvraj")).toBe("xbyuvraj");
    expect(normalizeName("Ćhamp_07")).toBe("champ07");
    expect(normalizeName("꧁꧂")).toBe("");
  });

  it("scores exact and near names", () => {
    expect(nameSimilarity("XB Yuvraj", "xb_yuvraj")).toBe(1);
    expect(nameSimilarity("XBYuvraj", "XBYuvrai")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Yuvraj", "khushi")).toBeLessThan(0.5);
    expect(nameSimilarity("", "x")).toBe(0);
  });
});

describe("matchReadRows", () => {
  const solo = [
    { registrationId: "r1", names: ["i miss him", "minecraft noobmyths"] },
    { registrationId: "r2", names: ["khushi"] },
    { registrationId: "r3", names: ["XB Yuvraj", "Yuvi"] },
  ];

  it("maps solo rows to entries and flags close matches", () => {
    const out = matchReadRows(solo, [
      { name: "imisshim", placement: 1, kills: 5, won: null },
      { name: "KHUSHI", placement: 2, kills: 3, won: null },
      { name: "XB Yuvrai", placement: 3, kills: 0, won: null },
      { name: "RandomGuy", placement: 4, kills: 1, won: null },
    ]);
    expect(out.suggestions).toEqual([
      {
        registrationId: "r1",
        confidence: "exact",
        readNames: ["imisshim"],
        placement: 1,
        kills: 5,
        won: null,
      },
      {
        registrationId: "r2",
        confidence: "exact",
        readNames: ["KHUSHI"],
        placement: 2,
        kills: 3,
        won: null,
      },
      {
        registrationId: "r3",
        confidence: "close",
        readNames: ["XB Yuvrai"],
        placement: 3,
        kills: 0,
        won: null,
      },
    ]);
    expect(out.unmatched).toEqual(["RandomGuy"]);
  });

  it("adds up a squad's kills, keeps its placement, and marks a head-to-head winner", () => {
    const squads = [
      { registrationId: "t1", names: ["Team Alpha", "Ace", "Bolt"] },
      { registrationId: "t2", names: ["Team Beta", "Cobra"] },
    ];
    const out = matchReadRows(squads, [
      { name: "Ace", placement: 2, kills: 4, won: null },
      { name: "Bolt", placement: 2, kills: 3, won: null },
      { name: "Cobra", placement: 1, kills: 6, won: null },
    ]);
    expect(out.suggestions.find((s) => s.registrationId === "t1")).toMatchObject({
      placement: 2,
      kills: 7,
    });
    expect(out.suggestions.find((s) => s.registrationId === "t2")).toMatchObject({
      placement: 1,
      kills: 6,
    });

    const h2h = matchReadRows(squads, [
      { name: "Team Alpha", placement: null, kills: null, won: false },
      { name: "Team Beta", placement: null, kills: null, won: true },
    ]);
    expect(h2h.suggestions.map((s) => [s.registrationId, s.won])).toEqual([
      ["t1", false],
      ["t2", true],
    ]);
  });

  it("leaves entries that were not read out of the suggestions", () => {
    const out = matchReadRows(solo, [{ name: "khushi", placement: 1, kills: 2, won: null }]);
    expect(out.suggestions.map((s) => s.registrationId)).toEqual(["r2"]);
  });
});
