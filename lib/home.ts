import type { HomeSettings } from "./content-keys";
import { GAME_CONFIG, type Game } from "./games";
import { isHeadToHead, MODE_LABEL, type MatchMode } from "./match-modes";

function floorTo(n: number, unit: number) {
  return Math.floor(n / unit);
}

/** Headline counts: 842 -> "842", 1_234 -> "1K+", 50_000 -> "50K+", 2_50_000 -> "2L+". */
export function compactCount(n: number): string {
  if (n < 1_000) return String(Math.max(0, Math.floor(n)));
  if (n < 1_00_000) return `${floorTo(n, 1_000)}K+`;
  if (n < 1_00_00_000) return `${floorTo(n, 1_00_000)}L+`;
  return `${floorTo(n, 1_00_00_000)}Cr+`;
}

/** Prize totals in Indian units: ₹10L+ as in the design. Input in paise. */
export function compactRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  if (rupees < 1_000) return `₹${Math.max(0, rupees)}`;
  return `₹${compactCount(rupees)}`;
}

export function todayCountLabel(n: number): string {
  if (n === 0) return "No matches today";
  return `${n} match${n === 1 ? "" : "es"} today`;
}

/**
 * A mode by its in-game name: Valorant solo is Deathmatch (DECISIONS M50); Free Fire's
 * head-to-head rooms are Lone Wolf (1v1, 2v2) and Clash Squad (4v4); BGMI's are TDM (4v4 = "TDM").
 */
export function gameModeLabel(game: Game, mode: MatchMode): string {
  if (game === "VALORANT" && mode === "SOLO") return "Deathmatch";
  if (game === "VALORANT" && mode === "TWO_V_TWO") return "Scrims";
  if (game === "FREE_FIRE" && (mode === "ONE_V_ONE" || mode === "TWO_V_TWO"))
    return `Lone Wolf ${MODE_LABEL[mode]}`;
  if (game === "FREE_FIRE" && mode === "FOUR_V_FOUR") return "Clash Squad";
  if (game === "BGMI" && mode === "FOUR_V_FOUR") return "TDM";
  if (game === "BGMI" && isHeadToHead(mode)) return `TDM ${MODE_LABEL[mode]}`;
  return MODE_LABEL[mode];
}

/** Order of a game's tournament mode buttons (Valorant: Deathmatch, Scrims, 5v5, then 1v1). */
const MODE_ORDER: Record<Game, MatchMode[]> = {
  FREE_FIRE: ["SOLO", "DUO", "SQUAD", "ONE_V_ONE", "TWO_V_TWO", "FOUR_V_FOUR"],
  BGMI: ["SOLO", "DUO", "SQUAD", "ONE_V_ONE", "TWO_V_TWO", "FOUR_V_FOUR"],
  VALORANT: ["SOLO", "TWO_V_TWO", "FIVE_V_FIVE", "ONE_V_ONE"],
};

/** A game's current tournaments in mode-button order; the first is the page's default. */
export function sortByModeOrder<T extends { mode: MatchMode }>(game: Game, list: T[]): T[] {
  const rank = (m: MatchMode) => {
    const i = MODE_ORDER[game].indexOf(m);
    return i < 0 ? MODE_ORDER[game].length : i;
  };
  return [...list].sort((a, b) => rank(a.mode) - rank(b.mode));
}

/** Tournament card format line: "4 Squad" for battle royale squads (the design), else the mode's name. */
export function tournamentFormatLabel(game: Game, mode: MatchMode): string {
  return mode === "SQUAD" ? `${GAME_CONFIG[game].teamSize} Squad` : gameModeLabel(game, mode);
}

export interface HomeStat {
  key: "players" | "tournaments" | "prize";
  value: string;
  label: string;
}

/** Real platform numbers for the hero; zero values are hidden rather than shown as "0". */
export function heroStats(raw: {
  players: number;
  tournaments: number;
  prizePaise: number;
}): HomeStat[] {
  const stats: [number, HomeStat][] = [
    [raw.players, { key: "players", value: compactCount(raw.players), label: "Active Players" }],
    [
      raw.tournaments,
      { key: "tournaments", value: compactCount(raw.tournaments), label: "Tournaments" },
    ],
    [
      raw.prizePaise,
      { key: "prize", value: compactRupees(raw.prizePaise), label: "Total Prize Pool" },
    ],
  ];
  return stats.filter(([n]) => n > 0).map(([, stat]) => stat);
}

const STAT_LABEL: Record<HomeStat["key"], string> = {
  players: "Active Players",
  tournaments: "Tournaments",
  prize: "Total Prize Pool",
};

/**
 * Hero stats row. Default: the admin's text values as typed (empty ones hidden). With "Use live stats"
 * on and counts available: real database numbers (zero values hidden, see heroStats).
 */
export function resolveHeroStats(
  settings: Pick<HomeSettings, "statPlayers" | "statTournaments" | "statPrize" | "liveStats">,
  live: { players: number; tournaments: number; prizePaise: number } | null,
): HomeStat[] {
  if (settings.liveStats && live) return heroStats(live);
  const text: [HomeStat["key"], string][] = [
    ["players", settings.statPlayers],
    ["tournaments", settings.statTournaments],
    ["prize", settings.statPrize],
  ];
  return text
    .filter(([, v]) => v.trim())
    .map(([key, v]) => ({ key, value: v.trim(), label: STAT_LABEL[key] }));
}

const TAGLINE_FIELD: Record<Game, "taglineFreeFire" | "taglineBgmi" | "taglineValorant"> = {
  FREE_FIRE: "taglineFreeFire",
  BGMI: "taglineBgmi",
  VALORANT: "taglineValorant",
};

/** "Squad up · Survive & dominate" → ["Squad up", "Survive & dominate"] (the design's two lines). */
export function heroTagline(
  settings: Pick<HomeSettings, "taglineFreeFire" | "taglineBgmi" | "taglineValorant">,
  game: Game,
): string[] {
  return settings[TAGLINE_FIELD[game]]
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
}
