/**
 * Admin content keys and labels. Zod-free so the admin editor (a client component) can import them
 * without shipping Zod; lib/content.ts holds the schemas and re-exports these.
 */

/** Admin-editable markdown blocks. */
export const CONTENT_KEYS = [
  "rules.FREE_FIRE",
  "rules.BGMI",
  "rules.VALORANT",
  "rules.general",
  "faq",
  "terms",
  "privacy",
  "refund-policy",
  "scrims.video",
  "tournament.howToRegister",
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

export const CONTENT_LABEL: Record<ContentKey, string> = {
  "rules.FREE_FIRE": "Rules — Free Fire",
  "rules.BGMI": "Rules — BGMI",
  "rules.VALORANT": "Rules — Valorant",
  "rules.general": "Rules — scoring, no-show and disputes (all games)",
  faq: "FAQ",
  terms: "Terms of service",
  privacy: "Privacy policy",
  "refund-policy": "Refund policy",
  "scrims.video":
    'Scrims page — "How scrims work" video link (https, leave empty to hide the button)',
  "tournament.howToRegister":
    'Tournament page — "How to Register" video link (https, e.g. YouTube; leave empty to hide the button)',
};

/** Content keys that hold a single link rather than markdown. */
export const LINK_CONTENT_KEYS: readonly ContentKey[] = ["scrims.video", "tournament.howToRegister"];

/**
 * Home page settings (Admin → Content → Home page), stored as SiteContent rows under these keys.
 * Stats are free text shown as-is unless "Use live stats" is on. The defaults are the design's demo
 * values (home-desktop.png) so the page looks complete from day one; replace them before launch.
 */
export const HOME_SETTING_KEYS = {
  statPlayers: "home.stats.players",
  statTournaments: "home.stats.tournaments",
  statPrize: "home.stats.prize",
  liveStats: "home.stats.live",
  trailerUrl: "home.trailer",
  taglineFreeFire: "home.tagline.FREE_FIRE",
  taglineBgmi: "home.tagline.BGMI",
  taglineValorant: "home.tagline.VALORANT",
} as const;

export type HomeSettingField = keyof typeof HOME_SETTING_KEYS;

export interface HomeSettings {
  statPlayers: string;
  statTournaments: string;
  statPrize: string;
  liveStats: boolean;
  trailerUrl: string | null;
  taglineFreeFire: string;
  taglineBgmi: string;
  taglineValorant: string;
}

export const HOME_DEFAULTS: HomeSettings = {
  statPlayers: "50K+",
  statTournaments: "1K+",
  statPrize: "₹10L+",
  liveStats: false,
  trailerUrl: null,
  taglineFreeFire: "Squad up · Survive & dominate",
  taglineBgmi: "Tactics · Skills & chicken dinner",
  taglineValorant: "Teamwork · Aim & win",
};

/** Settings from stored rows (key → body); missing rows fall back to the defaults. */
export function homeSettingsFromRows(rows: { key: string; body: string }[]): HomeSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.body]));
  const text = (field: Exclude<HomeSettingField, "liveStats" | "trailerUrl">) => {
    const v = byKey.get(HOME_SETTING_KEYS[field]);
    return v === undefined ? HOME_DEFAULTS[field] : v.trim();
  };
  const trailer = byKey.get(HOME_SETTING_KEYS.trailerUrl)?.trim();
  return {
    statPlayers: text("statPlayers"),
    statTournaments: text("statTournaments"),
    statPrize: text("statPrize"),
    liveStats: byKey.get(HOME_SETTING_KEYS.liveStats) === "true",
    trailerUrl: trailer && trailer.startsWith("https://") ? trailer : null,
    taglineFreeFire: text("taglineFreeFire"),
    taglineBgmi: text("taglineBgmi"),
    taglineValorant: text("taglineValorant"),
  };
}
