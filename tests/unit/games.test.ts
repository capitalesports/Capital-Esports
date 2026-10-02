import { describe, expect, it } from "vitest";
import { GAME_CONFIG, GAME_LIST, gameFromSlug, isBattleRoyale, isGame } from "@/lib/games";

describe("games config", () => {
  it("maps every slug back to its game", () => {
    for (const g of GAME_LIST) expect(gameFromSlug(g.slug)).toBe(g.id);
  });

  it("rejects unknown slugs and values", () => {
    expect(gameFromSlug("pubg")).toBeNull();
    expect(gameFromSlug(undefined)).toBeNull();
    expect(isGame("PUBG")).toBe(false);
    expect(isGame(42)).toBe(false);
    expect(isGame("BGMI")).toBe(true);
  });

  it("encodes the per-game structure from the spec", () => {
    expect(GAME_CONFIG.FREE_FIRE.matchMinutes).toBe(20);
    expect(GAME_CONFIG.BGMI.matchMinutes).toBe(30);
    expect(GAME_CONFIG.VALORANT.matchMinutes).toBe(60);
    expect(GAME_CONFIG.VALORANT.teamSize).toBe(5);
    expect(GAME_CONFIG.BGMI.teamSize).toBe(4);
    expect(isBattleRoyale("FREE_FIRE")).toBe(true);
    expect(isBattleRoyale("VALORANT")).toBe(false);
  });
});
