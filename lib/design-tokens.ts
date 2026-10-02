import type { Game } from "./games";

/**
 * The Design reference palette as hex, for places that can't read CSS variables
 * (ImageResponse OG cards and icons). Must match app/tokens.css (a unit test checks).
 */
export const DS = {
  background: "#0B0B0D",
  surface: "#14141A",
  border: "#26262E",
  gold: "#E8B33A",
  goldHover: "#F2C75C",
  text: "#F5F5F5",
  textSecondary: "#A0A0A8",
  success: "#22C55E",
  error: "#EF4444",
} as const;

export const GAME_HEX: Record<Game, string> = {
  FREE_FIRE: "#F28A1E",
  BGMI: "#2FBF8F",
  VALORANT: "#E8394B",
};
