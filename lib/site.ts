/** Brand name (DECISIONS M30). The wordmark shows the first word in gold: "Capital" + "Esports". */
export const SITE_NAME = "Capital Esports";
export const BRAND_ACCENT = "Capital";
export const BRAND_REST = "Esports";
/** Shown on the contact page and in the legal pages (lib/default-content.ts). */
export const SUPPORT_EMAIL = "capitalesportssupport@gmail.com";
export const SUPPORT_LOCATION = "New Delhi, India";
export const SITE_TAGLINE = "Play Daily Scrims · Weekly Tournaments · Climb the Leaderboard";

export const SOCIAL_PLATFORMS = [
  "WHATSAPP",
  "DISCORD",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  WHATSAPP: "WhatsApp Channel",
  DISCORD: "Discord",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
};

export interface SocialLink {
  platform: SocialPlatform;
  url: string | null;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}
