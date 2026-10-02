import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artKey, ARTWORK_NAMES, artworkSrc, hasArtwork, missingArtwork } from "@/lib/artwork";
import { MORE_NAV } from "@/lib/nav";
import { chipClass } from "@/lib/ui";
import { initials } from "@/components/common/player-avatar";
import { normaliseQuery } from "@/server/queries/search";

describe("artwork registry", () => {
  it("lists every asset name from the Design reference", () => {
    expect(ARTWORK_NAMES).toHaveLength(25);
    expect(ARTWORK_NAMES).toContain("hero-freefire");
    expect(ARTWORK_NAMES).toContain("trophy-podium");
    expect(ARTWORK_NAMES).toContain("texture-dark");
  });

  it("serves a file only when it was delivered", () => {
    expect(artworkSrc("trophy-podium", [])).toBeNull();
    expect(hasArtwork("trophy-podium", ["trophy-podium"])).toBe(true);
    expect(artworkSrc("trophy-podium", ["trophy-podium"])).toBe("/art/trophy-podium.png");
  });

  it("reports what is still missing", () => {
    expect(missingArtwork([])).toHaveLength(25);
    expect(missingArtwork(["logo", "app-icon"])).not.toContain("logo");
  });

  it("maps games to asset file stems", () => {
    expect(artKey("FREE_FIRE")).toBe("freefire");
    expect(artKey("BGMI")).toBe("bgmi");
    expect(artKey("VALORANT")).toBe("valorant");
  });
});

describe("design tokens", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../../app/tokens.css"), "utf8").toLowerCase();

  it.each([
    ["background", "#0b0b0d"],
    ["surface", "#14141a"],
    ["border", "#26262e"],
    ["gold", "#e8b33a"],
    ["gold-hover", "#f2c75c"],
    ["text", "#f5f5f5"],
    ["text-secondary", "#a0a0a8"],
    ["free-fire", "#f28a1e"],
    ["bgmi", "#2fbf8f"],
    ["valorant", "#e8394b"],
    ["success", "#22c55e"],
    ["error", "#ef4444"],
  ])("defines --ds-%s as %s", (name, value) => {
    expect(css).toContain(`--ds-${name}: ${value};`);
  });

  it("uses no colours outside the palette", () => {
    const hexes = new Set(css.match(/#[0-9a-f]{6}\b/g));
    expect([...hexes].sort()).toEqual(
      ["#0b0b0d", "#14141a", "#26262e", "#e8b33a", "#f2c75c", "#f5f5f5", "#a0a0a8", "#f28a1e", "#2fbf8f", "#e8394b", "#22c55e", "#ef4444"].sort(),
    );
    expect(css).not.toMatch(/oklch\(/);
  });

  it("sets a 12px card radius", () => {
    expect(css).toContain("--radius: 0.75rem;");
  });
});

describe("navigation and chips", () => {
  it("has the More dropdown items", () => {
    expect(MORE_NAV.map((m) => m.href)).toEqual(["/rules", "/faq", "/contact", "/leaderboard#past-seasons"]);
    expect(MORE_NAV.map((m) => m.label)).toEqual(["Rules", "FAQ", "Contact", "Past seasons"]);
  });
  it("marks the active chip in gold", () => {
    expect(chipClass(true)).toContain("border-gold");
    expect(chipClass(false)).toContain("border-border");
  });
});

describe("search query", () => {
  it("normalises and bounds the query", () => {
    expect(normaliseQuery("  tg   ayush ")).toBe("tg ayush");
    expect(normaliseQuery("a")).toBeNull();
    expect(normaliseQuery(["x"])).toBeNull();
    expect(normaliseQuery("x".repeat(100))).toHaveLength(64);
  });
});

describe("IST day label on match cards", async () => {
  const { istDayLabel } = await import("@/lib/time");
  const now = new Date("2026-09-27T12:00:00Z"); // 17:30 IST, Sunday
  it("says Today / Tomorrow / weekday by IST calendar day", () => {
    expect(istDayLabel(new Date("2026-09-27T15:30:00Z"), now)).toBe("Today");
    expect(istDayLabel(new Date("2026-09-27T19:00:00Z"), now)).toBe("Tomorrow"); // 00:30 IST on the 28th
    expect(istDayLabel(new Date("2026-09-29T14:30:00Z"), now)).toMatch(/Tue/);
  });
});

describe("player avatar fallback", () => {
  it("uses up to two initials", () => {
    expect(initials("tg ayush")).toBe("TA");
    expect(initials("Nexus")).toBe("NE");
    expect(initials("  ")).toBe("?");
  });
});

describe("hex palette for OG images and icons", async () => {
  const { DS, GAME_HEX } = await import("@/lib/design-tokens");
  const css = readFileSync(path.resolve(import.meta.dirname, "../../app/tokens.css"), "utf8").toLowerCase();
  it("mirrors app/tokens.css exactly", () => {
    const pairs: [string, string][] = [
      ["background", DS.background],
      ["surface", DS.surface],
      ["border", DS.border],
      ["gold", DS.gold],
      ["gold-hover", DS.goldHover],
      ["text", DS.text],
      ["text-secondary", DS.textSecondary],
      ["success", DS.success],
      ["error", DS.error],
      ["free-fire", GAME_HEX.FREE_FIRE],
      ["bgmi", GAME_HEX.BGMI],
      ["valorant", GAME_HEX.VALORANT],
    ];
    for (const [name, hex] of pairs) expect(css).toContain(`--ds-${name}: ${hex.toLowerCase()};`);
  });
});

describe("artwork sources (built by scripts/sync-art.mjs)", async () => {
  const { artworkSources, artworkWebpFor } = await import("@/lib/artwork");
  const meta = { "bg-bgmi": { width: 1672, height: 941, widths: [256, 384, 640, 960, 1280] } };
  it("builds a WebP srcset and a PNG fallback, or null while missing", () => {
    expect(artworkSources("bg-bgmi", meta)).toEqual({
      webpSrcSet: "/art/bg-bgmi-256.webp 256w, /art/bg-bgmi-384.webp 384w, /art/bg-bgmi-640.webp 640w, /art/bg-bgmi-960.webp 960w, /art/bg-bgmi-1280.webp 1280w",
      png: "/art/bg-bgmi.png",
      width: 1672,
      height: 941,
    });
    expect(artworkSources("hero-bgmi", meta)).toBeNull();
  });
  it("picks the smallest WebP wide enough for CSS backgrounds", () => {
    expect(artworkWebpFor("bg-bgmi", 300, 2, meta)).toBe("/art/bg-bgmi-640.webp");
    expect(artworkWebpFor("bg-bgmi", 1280, 1, meta)).toBe("/art/bg-bgmi-1280.webp");
    expect(artworkWebpFor("bg-bgmi", 4000, 2, meta)).toBe("/art/bg-bgmi-1280.webp");
    expect(artworkWebpFor("hero-bgmi", 300, 2, meta)).toBeNull();
  });
});
