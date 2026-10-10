import { describe, expect, it } from "vitest";
import {
  ageOn,
  canonicalGameId,
  dateOfBirthSchema,
  displayNameSchema,
  gameProfileRecord,
  gameProfileSchema,
  isValidRiotId,
  normalizePhone,
  parseRiotId,
  safeReturnTo,
} from "@/lib/validators";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+14155552671", "+14155552671"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "+915876543210", "0000000000", "abc", "+91987654321"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("Riot ID validation", () => {
  it.each(["Tenz#NA1", "Player One#AP01", "abc#123", "Ωmega#ind", "SixteenCharsName#12345"])(
    "accepts %s",
    (id) => {
      expect(isValidRiotId(id)).toBe(true);
    },
  );

  it.each([
    "NoTag",
    "#tag",
    "ab#123", // name too short
    "SeventeenCharName#AP1", // name too long
    "Name#ab", // tag too short
    "Name#abcdef", // tag too long
    "Na#me#tag", // two hashes
    "Bad!Name#AP1",
    "Name#a-b",
  ])("rejects %s", (id) => {
    expect(isValidRiotId(id)).toBe(false);
  });

  it("parses and trims name and tag", () => {
    expect(parseRiotId("  Player One # AP1 ")).toEqual({ name: "Player One", tag: "AP1" });
  });

  it("canonicalises Riot IDs case-insensitively", () => {
    expect(canonicalGameId("VALORANT", "TenZ#NA1")).toBe("tenz#na1");
    expect(canonicalGameId("VALORANT", "tenz#na1")).toBe(canonicalGameId("VALORANT", "TENZ#NA1"));
    expect(canonicalGameId("FREE_FIRE", " 123456 ")).toBe("123456");
  });
});

describe("gameProfileSchema", () => {
  it("validates a Free Fire UID", () => {
    expect(
      gameProfileSchema.safeParse({ game: "FREE_FIRE", gameId: "12345678", ign: "ÐΞΛTH々Sniper" })
        .success,
    ).toBe(true);
    // The exact in-game name is required and kept as typed (capitals, symbols, inner spaces).
    expect(gameProfileSchema.safeParse({ game: "FREE_FIRE", gameId: "12345678" }).success).toBe(
      false,
    );
    expect(
      gameProfileSchema.safeParse({ game: "FREE_FIRE", gameId: "12345678", ign: "  " }).success,
    ).toBe(false);
    expect(gameProfileSchema.safeParse({ game: "FREE_FIRE", gameId: "12ab" }).success).toBe(false);
  });

  it("requires an IGN for BGMI", () => {
    expect(gameProfileSchema.safeParse({ game: "BGMI", gameId: "5123456789" }).success).toBe(false);
    expect(
      gameProfileSchema.safeParse({ game: "BGMI", gameId: "5123456789", ign: "Scout" }).success,
    ).toBe(true);
  });

  it("requires a valid Riot ID and region for Valorant", () => {
    const ok = { game: "VALORANT", gameId: "Tenz#NA1", region: "AP" };
    expect(gameProfileSchema.safeParse(ok).success).toBe(true);
    expect(gameProfileSchema.safeParse({ ...ok, gameId: "Tenz" }).success).toBe(false);
    expect(gameProfileSchema.safeParse({ ...ok, region: "MARS" }).success).toBe(false);
    // No region field in the UI: it defaults to AP (Indian players' server).
    const noRegion = gameProfileSchema.parse({ game: "VALORANT", gameId: "Tenz#NA1" });
    expect(noRegion).toMatchObject({ region: "AP" });
  });

  it("rejects unknown games", () => {
    expect(gameProfileSchema.safeParse({ game: "PUBG", gameId: "1" }).success).toBe(false);
  });

  it("builds records to persist", () => {
    const v = gameProfileSchema.parse({ game: "VALORANT", gameId: "TenZ#NA1", region: "AP" });
    expect(gameProfileRecord(v)).toEqual({
      game: "VALORANT",
      gameId: "tenz#na1",
      ign: "TenZ#NA1",
      region: "AP",
    });
    const b = gameProfileSchema.parse({ game: "BGMI", gameId: "5123456789", ign: "Scout" });
    expect(gameProfileRecord(b)).toEqual({
      game: "BGMI",
      gameId: "5123456789",
      ign: "Scout",
      region: null,
    });
    const f = gameProfileSchema.parse({
      game: "FREE_FIRE",
      gameId: "12345678",
      ign: " Pro Killer_07 ",
    });
    expect(gameProfileRecord(f)).toEqual({
      game: "FREE_FIRE",
      gameId: "12345678",
      ign: "Pro Killer_07",
      region: null,
    });
  });
});

describe("profile fields", () => {
  it("validates display names", () => {
    expect(displayNameSchema.safeParse("Ace_07").success).toBe(true);
    expect(displayNameSchema.safeParse("A").success).toBe(false);
    expect(displayNameSchema.safeParse("<script>").success).toBe(false);
    expect(displayNameSchema.safeParse("x".repeat(31)).success).toBe(false);
  });

  it("computes age on a date", () => {
    const dob = new Date("2008-06-15T00:00:00Z");
    expect(ageOn(dob, new Date("2026-06-14T00:00:00Z"))).toBe(17);
    expect(ageOn(dob, new Date("2026-06-15T00:00:00Z"))).toBe(18);
  });

  it("validates date of birth", () => {
    expect(dateOfBirthSchema.safeParse("2005-02-28").success).toBe(true);
    expect(dateOfBirthSchema.safeParse("2005-02-30").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("28/02/2005").success).toBe(false);
    expect(dateOfBirthSchema.safeParse(new Date().toISOString().slice(0, 10)).success).toBe(false);
    expect(dateOfBirthSchema.safeParse("1900-01-01").success).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("allows relative paths only", () => {
    expect(safeReturnTo("/scrims/1?x=1")).toBe("/scrims/1?x=1");
    expect(safeReturnTo("https://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("//evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/\\evil.com")).toBe("/dashboard");
    expect(safeReturnTo(null, "/")).toBe("/");
  });
  it("refuses tab/newline/space tricks that browsers turn into another site (security review)", () => {
    expect(safeReturnTo("/\t/evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/\n/evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/\r\n/evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/ /evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/a\\b")).toBe("/dashboard");
    expect(safeReturnTo("/dashboard#top")).toBe("/dashboard#top");
  });
});
