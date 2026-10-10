import { GAME_CONFIG, type Game } from "./games";

export interface ProfileLike {
  displayName: string | null;
  dateOfBirth: Date | null;
  /** Updates go out by email, so a verified email is required (DECISIONS M12). */
  emailVerifiedAt: Date | null;
  gameProfiles: { game: Game; ign?: string | null }[];
}

/** Missing items that live on the profile page (the game ID is asked for where it's needed). */
export const PROFILE_ITEMS = ["display name", "date of birth", "verified email"] as const;

/**
 * Accounts made with Google may have no phone (DECISIONS M31). Money needs one: Cashfree asks for
 * the payer's and the prize winner's mobile number, so paid entry and payout methods require it.
 */
export const PHONE_ITEM = "mobile number";
export const PHONE_FOR_MONEY_MESSAGE =
  "Add your mobile number on your profile first: entry fee payments and prize transfers need it.";

/**
 * Name, date of birth and a verified email. Game IDs are asked for where they are needed
 * (registering for that game's match, creating a team), not on the profile. Computed, never stored.
 */
export function isProfileComplete(user: Omit<ProfileLike, "gameProfiles">): boolean {
  return (
    Boolean(user.displayName?.trim()) && user.dateOfBirth !== null && user.emailVerifiedAt !== null
  );
}

/** Free Fire and BGMI need the exact in-game name next to the numeric ID (Valorant's Riot ID has it). */
export function needsIgn(game: Game): boolean {
  return game === "FREE_FIRE" || game === "BGMI";
}

/** The game profile has everything admins need to find the player in the lobby. */
export function isGameProfileComplete(p: { game: Game; ign?: string | null }): boolean {
  return !needsIgn(p.game) || Boolean(p.ign?.trim());
}

/** The player's ID for `game`, or null (then the registration box asks for it inline). */
export function gameProfileFor<T extends { game: Game }>(
  user: { gameProfiles: T[] },
  game: Game,
): T | null {
  return user.gameProfiles.find((p) => p.game === game) ?? null;
}

/** Every item missingForRegistration (or the paid-entry phone check) can name. */
export function knownMissingItems(): string[] {
  return [
    ...PROFILE_ITEMS,
    PHONE_ITEM,
    ...Object.values(GAME_CONFIG).flatMap((g) => [g.idLabel, `${g.name} in-game name`]),
  ];
}

/** "display name, Free Fire UID" from a URL → only the known items (links can't inject text). */
export function safeMissingList(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const known = new Set(knownMissingItems());
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  return items.length ? [...new Set(items)].join(", ") : null;
}

/**
 * What the user still has to add before registering for a match in `game`.
 * Empty array = ready to register.
 */
export function missingForRegistration(user: ProfileLike, game: Game): string[] {
  const missing: string[] = [];
  if (!user.displayName?.trim()) missing.push("display name");
  if (!user.dateOfBirth) missing.push("date of birth");
  if (!user.emailVerifiedAt) missing.push("verified email");
  const profile = gameProfileFor(user, game);
  if (!profile) missing.push(GAME_CONFIG[game].idLabel);
  else if (!isGameProfileComplete(profile)) missing.push(`${GAME_CONFIG[game].name} in-game name`);
  return missing;
}
