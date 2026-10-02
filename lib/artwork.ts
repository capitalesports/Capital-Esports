import { ART_META, AVAILABLE_ART, type ArtMeta } from "./art-manifest";
import type { Game } from "./games";

/** Every artwork name the design uses (docs/PHASES.md "Expected asset names"). */
export const ARTWORK_NAMES = [
  "hero-freefire",
  "hero-bgmi",
  "hero-valorant",
  "bg-freefire",
  "bg-bgmi",
  "bg-valorant",
  "banner-freefire",
  "banner-bgmi",
  "banner-valorant",
  "card-match-freefire",
  "card-match-bgmi",
  "card-match-valorant",
  "card-tournament-freefire",
  "card-tournament-bgmi",
  "card-tournament-valorant",
  "empty-no-matches",
  "empty-no-team",
  "empty-no-notifications",
  "empty-offline",
  "empty-profile",
  "trophy-podium",
  "logo",
  "app-icon",
  "og-background",
  "texture-dark",
] as const;

export type ArtworkName = (typeof ARTWORK_NAMES)[number];

/** Asset file stem for a game ("FREE_FIRE" -> "freefire"). */
export function artKey(game: Game): "freefire" | "bgmi" | "valorant" {
  return game === "FREE_FIRE" ? "freefire" : game === "BGMI" ? "bgmi" : "valorant";
}

export function hasArtwork(
  name: ArtworkName,
  available: readonly string[] = AVAILABLE_ART,
): boolean {
  return available.includes(name);
}

/** Public URL of an artwork file, or null when it has not been delivered yet. */
export function artworkSrc(
  name: ArtworkName,
  available: readonly string[] = AVAILABLE_ART,
): string | null {
  return hasArtwork(name, available) ? `/art/${name}.png` : null;
}

/** Names the design expects but docs/design/assets/ does not contain yet. */
export function missingArtwork(available: readonly string[] = AVAILABLE_ART): ArtworkName[] {
  return ARTWORK_NAMES.filter((n) => !available.includes(n));
}

export interface ArtworkSources {
  /** "…-256.webp 256w, …-640.webp 640w, …" for <source type="image/webp">. */
  webpSrcSet: string;
  /** Optimized PNG fallback (≤ 1280 px) for browsers without WebP. */
  png: string;
  width: number;
  height: number;
}

/** Responsive sources for a delivered artwork (built by scripts/sync-art.mjs), or null while missing. */
export function artworkSources(
  name: ArtworkName,
  meta: Readonly<Record<string, ArtMeta>> = ART_META,
): ArtworkSources | null {
  const m = meta[name];
  if (!m) return null;
  return {
    webpSrcSet: m.widths.map((w) => `/art/${name}-${w}.webp ${w}w`).join(", "),
    png: `/art/${name}.png`,
    width: m.width,
    height: m.height,
  };
}

/** Smallest WebP variant at least `cssWidth × dpr` wide (largest available otherwise), e.g. for CSS backgrounds. */
export function artworkWebpFor(
  name: ArtworkName,
  cssWidth: number,
  dpr = 2,
  meta: Readonly<Record<string, ArtMeta>> = ART_META,
): string | null {
  const m = meta[name];
  if (!m) return null;
  const need = cssWidth * dpr;
  const w = m.widths.find((x) => x >= need) ?? m.widths.at(-1)!;
  return `/art/${name}-${w}.webp`;
}
