import { describe, expect, it } from "vitest";
import {
  isOpenEntry,
  lobbiesNeeded,
  lobbyNoun,
  lobbyWord,
  planLobbies,
  planDuoTournamentLobbies,
  planTournamentLobbies,
} from "@/lib/lobbies";

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

describe("tournament lobbies (DECISIONS M50)", () => {
  it("fills one lobby, then splits evenly", () => {
    expect(planTournamentLobbies(30, 48)).toEqual({ sizes: [30], unplaced: 0 });
    expect(planTournamentLobbies(48, 48)).toEqual({ sizes: [48], unplaced: 0 });
    expect(planTournamentLobbies(52, 48)).toEqual({ sizes: [26, 26], unplaced: 0 });
    expect(planTournamentLobbies(101, 100)).toEqual({ sizes: [51, 50], unplaced: 0 });
    expect(planTournamentLobbies(97, 48)).toEqual({ sizes: [33, 32, 32], unplaced: 0 });
  });

  it("never opens a lobby under 10: the extras don't play", () => {
    // Valorant Deathmatch, 10 per lobby.
    expect(planTournamentLobbies(12, 10)).toEqual({ sizes: [10], unplaced: 2 });
    expect(planTournamentLobbies(20, 10)).toEqual({ sizes: [10, 10], unplaced: 0 });
    expect(planTournamentLobbies(25, 10)).toEqual({ sizes: [10, 10], unplaced: 5 });
  });

  it("keeps a small tournament in one lobby", () => {
    expect(planTournamentLobbies(6, 48)).toEqual({ sizes: [6], unplaced: 0 });
    expect(planTournamentLobbies(0, 48)).toEqual({ sizes: [], unplaced: 0 });
  });
});

describe("duo tournament lobbies (DECISIONS M50)", () => {
  it("keeps partners together: lobbies of even size, an odd player joins the last lobby", () => {
    expect(planDuoTournamentLobbies(129, 48)).toEqual({ sizes: [44, 42, 43], unplaced: 0 });
    expect(planDuoTournamentLobbies(96, 48)).toEqual({ sizes: [48, 48], unplaced: 0 });
    expect(planDuoTournamentLobbies(161, 100)).toEqual({ sizes: [80, 81], unplaced: 0 });
    // Both lobbies full: the odd player (no partner anyway) is left out.
    expect(planDuoTournamentLobbies(97, 48)).toEqual({ sizes: [48, 48], unplaced: 1 });
    expect(planDuoTournamentLobbies(7, 48)).toEqual({ sizes: [7], unplaced: 0 });
  });
});
