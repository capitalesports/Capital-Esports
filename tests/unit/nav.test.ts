import { describe, expect, it } from "vitest";
import { currentSwitcherGame, isActivePath, switcherHref, switcherSection } from "@/lib/nav";

describe("isActivePath", () => {
  it("matches home only exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/scrims", "/")).toBe(false);
  });
  it("matches nested routes", () => {
    expect(isActivePath("/scrims/abc", "/scrims")).toBe(true);
    expect(isActivePath("/scrimsx", "/scrims")).toBe(false);
  });
});

describe("game switcher", () => {
  it("appears on tournament and leaderboard pages; /scrims has its own game strip", () => {
    expect(switcherSection("/scrims")).toBeNull();
    expect(switcherSection("/tournament/bgmi")).toBe("tournament");
    expect(switcherSection("/leaderboard/valorant/seasons/1")).toBe("leaderboard");
    expect(switcherSection("/")).toBeNull();
    expect(switcherSection("/dashboard")).toBeNull();
  });

  it("reads the current game from the path", () => {
    expect(currentSwitcherGame("/tournament/free-fire")).toBe("FREE_FIRE");
    expect(currentSwitcherGame("/leaderboard")).toBeNull();
    expect(currentSwitcherGame("/scrims")).toBeNull();
  });

  it("builds hrefs per section", () => {
    expect(switcherHref("leaderboard", "BGMI")).toBe("/leaderboard/bgmi");
    expect(switcherHref("tournament", "VALORANT")).toBe("/tournament/valorant");
  });
});
