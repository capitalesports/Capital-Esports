import { describe, expect, it } from "vitest";
import {
  isGameProfileComplete,
  isProfileComplete,
  missingForRegistration,
  needsIgn,
} from "@/lib/profile";

const dob = new Date("2000-01-01T00:00:00Z");
const verified = new Date("2026-09-01T00:00:00Z");
const bgmi = [{ game: "BGMI" as const, ign: "ShadowAce" }];

describe("isProfileComplete", () => {
  it("requires name, date of birth and a verified email; game IDs are asked for at registration", () => {
    const base = { displayName: "Ace", dateOfBirth: dob, emailVerifiedAt: verified };
    expect(isProfileComplete(base)).toBe(true);
    expect(isProfileComplete({ ...base, displayName: null })).toBe(false);
    expect(isProfileComplete({ ...base, displayName: "  " })).toBe(false);
    expect(isProfileComplete({ ...base, dateOfBirth: null })).toBe(false);
    expect(isProfileComplete({ ...base, emailVerifiedAt: null })).toBe(false);
    const noGameIds = { ...base, gameProfiles: [] };
    expect(isProfileComplete(noGameIds)).toBe(true);
  });
});

describe("game profiles", () => {
  it("need the exact in-game name for Free Fire and BGMI (Valorant's Riot ID carries it)", () => {
    expect(needsIgn("FREE_FIRE")).toBe(true);
    expect(needsIgn("VALORANT")).toBe(false);
    expect(isGameProfileComplete({ game: "FREE_FIRE", ign: null })).toBe(false);
    expect(isGameProfileComplete({ game: "FREE_FIRE", ign: " " })).toBe(false);
    expect(isGameProfileComplete({ game: "FREE_FIRE", ign: "ÐΞΛTH々Sniper" })).toBe(true);
    expect(isGameProfileComplete({ game: "VALORANT", ign: null })).toBe(true);
  });
});

describe("missingForRegistration", () => {
  const user = { displayName: "Ace", dateOfBirth: dob, emailVerifiedAt: verified, gameProfiles: bgmi };

  it("names the missing game ID, or the missing in-game name, for the match's game", () => {
    expect(missingForRegistration(user, "BGMI")).toEqual([]);
    expect(missingForRegistration(user, "VALORANT")).toEqual(["Riot ID"]);
    expect(
      missingForRegistration({ ...user, gameProfiles: [{ game: "FREE_FIRE", ign: null }] }, "FREE_FIRE"),
    ).toEqual(["Free Fire in-game name"]);
  });

  it("lists every missing field", () => {
    expect(
      missingForRegistration(
        { displayName: null, dateOfBirth: null, emailVerifiedAt: null, gameProfiles: [] },
        "FREE_FIRE",
      ),
    ).toEqual(["display name", "date of birth", "verified email", "Free Fire UID"]);
  });
});
