import { gameFromSlug, GAME_CONFIG, type Game } from "./games";

export interface NavItem {
  href: string;
  label: string;
}

/** Top-level links shown in the navbar (design: Home, Scrims, Tournament, Leaderboard, Games ▾, More ▾). */
export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/scrims", label: "Scrims" },
  { href: "/tournament", label: "Tournament" },
  { href: "/leaderboard", label: "Leaderboard" },
];

/** "More" dropdown. */
export const MORE_NAV: NavItem[] = [
  { href: "/rules", label: "Rules" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/leaderboard#past-seasons", label: "Past seasons" },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/rules", label: "Rules" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refund-policy", label: "Refund policy" },
];

/** Footer link row (scrims-desktop.png): Home … Contact. */
export const FOOTER_LINKS: NavItem[] = [
  ...MAIN_NAV,
  { href: "/games", label: "Games" },
  { href: "/rules", label: "Rules" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

/** Small legal row under the footer. */
export const LEGAL_NAV: NavItem[] = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refund-policy", label: "Refund policy" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sections that show the game switcher chips under the navbar. /scrims has its own game strip
 * (scrims-desktop.png), so it is not one of them.
 */
type SwitcherSection = "tournament" | "leaderboard";

export function switcherSection(pathname: string): SwitcherSection | null {
  const first = pathname.split("/")[1];
  return first === "tournament" || first === "leaderboard" ? first : null;
}

/** Current game for the switcher, read from /section/[game]. */
export function currentSwitcherGame(pathname: string): Game | null {
  return switcherSection(pathname) ? gameFromSlug(pathname.split("/")[2]) : null;
}

/** Where the switcher links to for a given game. */
export function switcherHref(section: SwitcherSection, game: Game): string {
  return `/${section}/${GAME_CONFIG[game].slug}`;
}
