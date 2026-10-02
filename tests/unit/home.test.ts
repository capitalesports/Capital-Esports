import { describe, expect, it } from "vitest";
import { HOME_DEFAULTS, HOME_SETTING_KEYS, homeSettingsFromRows } from "@/lib/content-keys";
import {
  compactCount,
  compactRupees,
  heroStats,
  heroTagline,
  resolveHeroStats,
  todayCountLabel,
  tournamentFormatLabel,
} from "@/lib/home";

describe("hero stats formatting", () => {
  it.each([
    [0, "0"],
    [842, "842"],
    [1_234, "1K+"],
    [50_000, "50K+"],
    [99_999, "99K+"],
    [2_50_000, "2L+"],
    [3_00_00_000, "3Cr+"],
  ])("compactCount(%d) = %s", (n, out) => {
    expect(compactCount(n)).toBe(out);
  });

  it("formats prize totals in Indian units from paise", () => {
    expect(compactRupees(50_000)).toBe("₹500");
    expect(compactRupees(10_00_000_00)).toBe("₹10L+");
    expect(compactRupees(75_000_00)).toBe("₹75K+");
  });

  it("hides zero stats instead of showing 0", () => {
    expect(heroStats({ players: 0, tournaments: 0, prizePaise: 0 })).toEqual([]);
    const s = heroStats({ players: 52_000, tournaments: 3, prizePaise: 0 });
    expect(s.map((x) => x.key)).toEqual(["players", "tournaments"]);
    expect(s[0]).toEqual({ key: "players", value: "52K+", label: "Active Players" });
  });
});

describe("home copy", () => {
  it("labels today's match counts", () => {
    expect(todayCountLabel(0)).toBe("No matches today");
    expect(todayCountLabel(1)).toBe("1 match today");
    expect(todayCountLabel(4)).toBe("4 matches today");
  });
  it("uses the design's format labels", () => {
    expect(tournamentFormatLabel("FREE_FIRE", "SQUAD")).toBe("4 Squad");
    expect(tournamentFormatLabel("BGMI", "SQUAD")).toBe("4 Squad");
    expect(tournamentFormatLabel("VALORANT", "FIVE_V_FIVE")).toBe("5v5");
    expect(tournamentFormatLabel("FREE_FIRE", "ONE_V_ONE")).toBe("1v1");
    expect(tournamentFormatLabel("BGMI", "TWO_V_TWO")).toBe("2v2");
  });
  it("splits the admin tagline into the design's two lines", () => {
    expect(heroTagline(HOME_DEFAULTS, "FREE_FIRE")).toEqual(["Squad up", "Survive & dominate"]);
    expect(heroTagline(HOME_DEFAULTS, "BGMI")).toEqual(["Tactics", "Skills & chicken dinner"]);
    expect(heroTagline(HOME_DEFAULTS, "VALORANT")).toEqual(["Teamwork", "Aim & win"]);
    expect(heroTagline({ ...HOME_DEFAULTS, taglineBgmi: "Win big" }, "BGMI")).toEqual(["Win big"]);
    expect(heroTagline({ ...HOME_DEFAULTS, taglineBgmi: " A ·  B · C " }, "BGMI")).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("hero stats: admin text or live counts", () => {
  const live = { players: 1_234, tournaments: 3, prizePaise: 0 };

  it("shows the seeded demo values as typed by default", () => {
    expect(resolveHeroStats(HOME_DEFAULTS, null)).toEqual([
      { key: "players", value: "50K+", label: "Active Players" },
      { key: "tournaments", value: "1K+", label: "Tournaments" },
      { key: "prize", value: "₹10L+", label: "Total Prize Pool" },
    ]);
  });

  it("hides a stat whose text is empty and trims the rest", () => {
    const s = resolveHeroStats({ ...HOME_DEFAULTS, statPlayers: "  ", statPrize: " ₹5L+ " }, null);
    expect(s.map((x) => [x.key, x.value])).toEqual([
      ["tournaments", "1K+"],
      ["prize", "₹5L+"],
    ]);
  });

  it("ignores live counts while the toggle is off, and uses them (zeros hidden) when on", () => {
    expect(
      resolveHeroStats({ ...HOME_DEFAULTS, liveStats: false }, live).map((x) => x.value),
    ).toEqual(["50K+", "1K+", "₹10L+"]);
    expect(resolveHeroStats({ ...HOME_DEFAULTS, liveStats: true }, live)).toEqual([
      { key: "players", value: "1K+", label: "Active Players" },
      { key: "tournaments", value: "3", label: "Tournaments" },
    ]);
  });

  it("falls back to the text when the toggle is on but no counts were loaded", () => {
    expect(
      resolveHeroStats({ ...HOME_DEFAULTS, liveStats: true }, null).map((x) => x.value),
    ).toEqual(["50K+", "1K+", "₹10L+"]);
  });
});

describe("home settings from stored rows", () => {
  it("uses the defaults when nothing is stored", () => {
    expect(homeSettingsFromRows([])).toEqual(HOME_DEFAULTS);
  });

  it("reads stored values, keeps an intentionally empty stat, and only accepts https trailers", () => {
    const s = homeSettingsFromRows([
      { key: HOME_SETTING_KEYS.statPlayers, body: "" },
      { key: HOME_SETTING_KEYS.liveStats, body: "true" },
      { key: HOME_SETTING_KEYS.trailerUrl, body: " https://youtu.be/x " },
      { key: HOME_SETTING_KEYS.taglineValorant, body: "Plant · Defuse" },
    ]);
    expect(s).toMatchObject({
      statPlayers: "",
      liveStats: true,
      trailerUrl: "https://youtu.be/x",
      taglineValorant: "Plant · Defuse",
      statPrize: "₹10L+",
    });
    expect(
      homeSettingsFromRows([{ key: HOME_SETTING_KEYS.trailerUrl, body: "javascript:alert(1)" }])
        .trailerUrl,
    ).toBeNull();
    expect(
      homeSettingsFromRows([{ key: HOME_SETTING_KEYS.liveStats, body: "yes" }]).liveStats,
    ).toBe(false);
  });
});
