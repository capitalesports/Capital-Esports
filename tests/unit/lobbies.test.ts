import { describe, expect, it } from "vitest";
import { isOpenEntry, lobbiesNeeded, lobbyNoun, lobbyWord, planLobbies } from "@/lib/lobbies";

const scrim = { isEntryList: false, tournamentId: null, bracketRound: null, parentMatchId: null };

describe("open entry", () => {
  it("applies to standalone scrims only", () => {
    expect(isOpenEntry(scrim)).toBe(true);
    expect(isOpenEntry({ ...scrim, isEntryList: true })).toBe(false);
    expect(isOpenEntry({ ...scrim, tournamentId: "t" })).toBe(false);
    expect(isOpenEntry({ ...scrim, bracketRound: 1 })).toBe(false);
    expect(isOpenEntry({ ...scrim, parentMatchId: "m" })).toBe(false);
  });
});

describe("planLobbies", () => {
  it("keeps one lobby while it fits", () => {
    expect(planLobbies(0, 48, "SOLO")).toEqual({ sizes: [], unplaced: 0 });
    expect(planLobbies(30, 48, "SOLO")).toEqual({ sizes: [30], unplaced: 0 });
    expect(planLobbies(48, 48, "SOLO")).toEqual({ sizes: [48], unplaced: 0 });
  });

  it("opens more lobbies when entries overflow, balanced", () => {
    expect(planLobbies(96, 48, "SOLO").sizes).toEqual([48, 48]);
    expect(planLobbies(50, 48, "SOLO").sizes).toEqual([25, 25]);
    expect(planLobbies(101, 48, "SOLO").sizes).toEqual([34, 34, 33]);
    expect(planLobbies(26, 25, "SQUAD").sizes).toEqual([13, 13]);
    expect(planLobbies(101, 48, "SOLO").sizes.reduce((a, b) => a + b)).toBe(101);
  });

  it("pairs head-to-head sides into games, leaving an odd one out", () => {
    expect(planLobbies(20, 2, "ONE_V_ONE")).toEqual({ sizes: Array(10).fill(2), unplaced: 0 });
    expect(planLobbies(21, 2, "ONE_V_ONE")).toEqual({ sizes: Array(10).fill(2), unplaced: 1 });
    expect(planLobbies(2, 2, "FIVE_V_FIVE")).toEqual({ sizes: [2], unplaced: 0 });
    expect(planLobbies(1, 2, "TWO_V_TWO")).toEqual({ sizes: [1], unplaced: 0 });
  });

  it("names and counts lobbies", () => {
    expect(lobbyWord("SQUAD")).toBe("Lobby");
    expect(lobbyWord("ONE_V_ONE")).toBe("Game");
    expect(lobbyNoun("SOLO", 1)).toBe("lobby");
    expect(lobbyNoun("SOLO", 2)).toBe("lobbies");
    expect(lobbyNoun("TWO_V_TWO", 3)).toBe("games");
    expect(lobbiesNeeded(0, 48, "SOLO")).toBe(1);
    expect(lobbiesNeeded(97, 48, "SOLO")).toBe(3);
    expect(lobbiesNeeded(7, 2, "ONE_V_ONE")).toBe(3);
  });
});
