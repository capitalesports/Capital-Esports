import { z } from "zod";
import { isSafeSitePath } from "./input-rules";
import { GAMES } from "./games";
import { SOCIAL_PLATFORMS } from "./site";
import { CONTENT_KEYS, LINK_CONTENT_KEYS } from "./content-keys";

export * from "./content-keys";

/** Accept https URLs or our own uploaded-file paths. */
export const linkUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    if (v.startsWith("/api/files/")) return true;
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a full https:// link");

const optionalLink = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .pipe(linkUrl.nullable());

export const contentSchema = z
  .object({
    key: z.enum(CONTENT_KEYS),
    body: z.string().max(50_000, "Too long (50,000 characters max)"),
  })
  .superRefine((v, ctx) => {
    if (!LINK_CONTENT_KEYS.includes(v.key)) return;
    const body = v.body.trim();
    if (body && !linkUrl.safeParse(body).success)
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Enter a full https:// link, or leave it empty",
      });
  });

/** A link-type content value, or null when empty/invalid (so pages can hide the button). */
export function contentLink(body: string): string | null {
  const v = body.trim();
  return v && linkUrl.safeParse(v).success && v.startsWith("https://") ? v : null;
}

export const sponsorSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(60),
  logoUrl: linkUrl,
  url: optionalLink,
  order: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

export const socialLinksSchema = z.object(
  Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, optionalLink])) as Record<
    (typeof SOCIAL_PLATFORMS)[number],
    typeof optionalLink
  >,
);

export const carouselItemSchema = z.object({
  id: z.string().optional(),
  game: z
    .enum(GAMES)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  title: z.string().trim().min(2).max(80),
  subtitle: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => v || null),
  imageUrl: optionalLink,
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null)
    .refine(
      (v) => v === null || isSafeSitePath(v) || /^https:\/\/\S+$/.test(v),
      "Use a site path (/...) or https:// link",
    ),
  order: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

const statText = z
  .string()
  .trim()
  .max(12, "Keep it short (12 characters max), e.g. 50K+")
  .regex(/^[^<>\n]*$/, "Plain text only");
const tagline = z.string().trim().min(3, "At least 3 characters").max(60, "60 characters max");

/** Admin → Content → Home page. Empty stat text hides that stat; the trailer must be an https link or empty. */
export const homeSettingsSchema = z.object({
  statPlayers: statText,
  statTournaments: statText,
  statPrize: statText,
  liveStats: z.boolean(),
  trailerUrl: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(
      z
        .string()
        .url()
        .refine((v) => v.startsWith("https://"), "Enter a full https:// link, or leave it empty")
        .nullable(),
    ),
  taglineFreeFire: tagline,
  taglineBgmi: tagline,
  taglineValorant: tagline,
});
