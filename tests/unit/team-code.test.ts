import { describe, expect, it } from "vitest";
import { playerIdLabel } from "@/lib/player-label";
import { normalizeTeamCode, randomTeamCode, TEAM_CODE_ALPHABET } from "@/lib/team-code";

describe("team join codes", () => {
  it("builds 5 capital letters without I or O", () => {
    expect(randomTeamCode(() => 0)).toBe("AAAAA");
    expect(randomTeamCode((n) => n - 1)).toBe("ZZZZZ");
    expect(TEAM_CODE_ALPHABET).not.toMatch(/[IO]/);
    let i = 0;
    expect(randomTeamCode(() => i++)).toBe("ABCDE");
  });

  it("normalises what players type", () => {
    expect(normalizeTeamCode(" kqz-tr ")).toBe("KQZTR");
    expect(normalizeTeamCode("KQZT")).toBeNull();
    expect(normalizeTeamCode("KQZTRS")).toBeNull();
    expect(normalizeTeamCode("KQ0TR")).toBeNull();
    expect(normalizeTeamCode("KQITR")).toBeNull();
  });
});

describe("playerIdLabel", () => {
  it("shows a Valorant Riot ID once, as typed", () => {
    expect(playerIdLabel("VALORANT", "jerry#025", "JERRY#025")).toBe("JERRY#025");
    expect(playerIdLabel("VALORANT", "jerry#025", null)).toBe("jerry#025");
  });

  it("shows the in-game name then the numeric ID for Free Fire / BGMI", () => {
    expect(playerIdLabel("FREE_FIRE", "12345678", "ÐΞΛTH々")).toBe("ÐΞΛTH々 · 12345678");
    expect(playerIdLabel("BGMI", "5123456789", null)).toBe("5123456789");
    expect(playerIdLabel("BGMI", null, null)).toBe("no ID");
  });
});
