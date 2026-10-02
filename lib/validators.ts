import { z } from "zod";
import type { Game } from "./games";
import {
  ageOn,
  canonicalGameId,
  isValidRiotId,
  MAX_AGE,
  MIN_AGE,
  normalizePhone,
  parseRiotId,
  VALORANT_REGIONS,
} from "./input-rules";

export * from "./input-rules";

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

export const phoneSchema = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
    return z.NEVER;
  }
  return phone;
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(30, "Name must be at most 30 characters")
  .regex(/^[\p{L}\p{N} ._'-]+$/u, "Use letters, numbers, spaces and . _ ' - only");

export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .transform((v, ctx) => {
    const date = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: "Enter a real date" });
      return z.NEVER;
    }
    const age = ageOn(date, new Date());
    if (age < MIN_AGE || age > MAX_AGE) {
      ctx.addIssue({ code: "custom", message: `Age must be between ${MIN_AGE} and ${MAX_AGE}` });
      return z.NEVER;
    }
    return date;
  });

export const profileSchema = z.object({
  displayName: displayNameSchema,
  dateOfBirth: dateOfBirthSchema,
});

// ---------------------------------------------------------------------------
// Game IDs
// ---------------------------------------------------------------------------

export const freeFireUidSchema = z
  .string()
  .trim()
  .regex(/^\d{6,12}$/, "Free Fire UID is 6–12 digits");

export const bgmiIdSchema = z
  .string()
  .trim()
  .regex(/^\d{6,15}$/, "BGMI Character ID is 6–15 digits");

/**
 * In-game name exactly as the game shows it: capitals, symbols and spaces inside are kept as typed
 * (only leading/trailing spaces are dropped), so admins can match it in the lobby letter for letter.
 */
export const ignSchema = z
  .string()
  .trim()
  .min(1, "Enter your in-game name exactly as it appears in the game")
  .max(24, "In-game name must be at most 24 characters")
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "In-game name has invisible characters");

export const gameProfileSchema = z.discriminatedUnion("game", [
  z.object({
    game: z.literal("FREE_FIRE"),
    gameId: freeFireUidSchema,
    ign: ignSchema,
  }),
  z.object({
    game: z.literal("BGMI"),
    gameId: bgmiIdSchema,
    ign: ignSchema,
  }),
  z.object({
    game: z.literal("VALORANT"),
    gameId: z
      .string()
      .trim()
      .refine(isValidRiotId, "Riot ID must look like Name#Tag (tag is 3–5 letters or numbers)"),
    // No region field in the UI: Indian players are on the AP server (DECISIONS M15).
    region: z.enum(VALORANT_REGIONS, { message: "Choose your Valorant region" }).default("AP"),
  }),
]);

export type GameProfileInput = z.infer<typeof gameProfileSchema>;

/** Values to persist for a validated game profile. */
export function gameProfileRecord(input: GameProfileInput): {
  game: Game;
  gameId: string;
  ign: string | null;
  region: string | null;
} {
  switch (input.game) {
    case "FREE_FIRE":
      return { game: input.game, gameId: input.gameId, ign: input.ign, region: null };
    case "BGMI":
      return { game: input.game, gameId: input.gameId, ign: input.ign, region: null };
    case "VALORANT": {
      const riot = parseRiotId(input.gameId)!;
      return {
        game: input.game,
        gameId: canonicalGameId("VALORANT", input.gameId),
        ign: `${riot.name}#${riot.tag}`,
        region: input.region,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
