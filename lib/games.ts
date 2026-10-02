/**
 * Static per-game configuration. Values mirror docs/SPEC.md "Games and per-game structure".
 * The `Game` union matches the Prisma `Game` enum.
 */

export const GAMES = ["FREE_FIRE", "BGMI", "VALORANT"] as const;
export type Game = (typeof GAMES)[number];

export type GameSlug = "free-fire" | "bgmi" | "valorant";

export interface GameConfig {
  id: Game;
  slug: GameSlug;
  name: string;
  shortName: string;
  platform: "Mobile" | "PC";
  format: "BATTLE_ROYALE" | "FIVE_V_FIVE";
  /** Players per team for squad/5v5 registration. */
  teamSize: number;
  /** Expected match length, used by the cron job to move LIVE -> RESULTS_PENDING. */
  matchMinutes: number;
  /** Label for the in-game player ID field. */
  idLabel: string;
  /** Tailwind classes for the game accent (cards and game pages only). */
  accent: { bg: string; text: string; border: string; borderSoft: string; ring: string };
}

export const GAME_CONFIG: Record<Game, GameConfig> = {
  FREE_FIRE: {
    id: "FREE_FIRE",
    slug: "free-fire",
    name: "Free Fire",
    shortName: "FF",
    platform: "Mobile",
    format: "BATTLE_ROYALE",
    teamSize: 4,
    matchMinutes: 20,
    idLabel: "Free Fire UID",
    accent: {
      bg: "bg-game-free-fire text-game-accent-foreground",
      text: "text-game-free-fire",
      border: "border-game-free-fire",
      borderSoft: "border-game-free-fire/60",
      ring: "ring-game-free-fire",
    },
  },
  BGMI: {
    id: "BGMI",
    slug: "bgmi",
    name: "BGMI",
    shortName: "BGMI",
    platform: "Mobile",
    format: "BATTLE_ROYALE",
    teamSize: 4,
    matchMinutes: 30,
    idLabel: "BGMI Character ID",
    accent: {
      bg: "bg-game-bgmi text-game-accent-foreground",
      text: "text-game-bgmi",
      border: "border-game-bgmi",
      borderSoft: "border-game-bgmi/60",
      ring: "ring-game-bgmi",
    },
  },
  VALORANT: {
    id: "VALORANT",
    slug: "valorant",
    name: "Valorant",
    shortName: "VAL",
    platform: "PC",
    format: "FIVE_V_FIVE",
    teamSize: 5,
    matchMinutes: 60,
    idLabel: "Riot ID",
    accent: {
      bg: "bg-game-valorant text-game-accent-foreground",
      text: "text-game-valorant",
      border: "border-game-valorant",
      borderSoft: "border-game-valorant/60",
      ring: "ring-game-valorant",
    },
  },
};

export const GAME_LIST: GameConfig[] = GAMES.map((g) => GAME_CONFIG[g]);

export function isGame(value: unknown): value is Game {
  return typeof value === "string" && (GAMES as readonly string[]).includes(value);
}

export function gameFromSlug(slug: string | null | undefined): Game | null {
  if (!slug) return null;
  return GAME_LIST.find((g) => g.slug === slug)?.id ?? null;
}

export function isBattleRoyale(game: Game): boolean {
  return GAME_CONFIG[game].format === "BATTLE_ROYALE";
}
