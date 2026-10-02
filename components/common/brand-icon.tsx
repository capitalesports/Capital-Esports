import { siDiscord, siFacebook, siInstagram, siWhatsapp, siYoutube } from "simple-icons";
import type { SocialPlatform } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Social network logos (DECISIONS M24: the owner asked for the real marks; lucide has none). Paths
 * come from simple-icons and use `currentColor`, so they follow the design tokens (no brand hex).
 * Server-rendered SVG: no client JavaScript.
 */
const PATHS: Record<SocialPlatform, string> = {
  WHATSAPP: siWhatsapp.path,
  DISCORD: siDiscord.path,
  INSTAGRAM: siInstagram.path,
  FACEBOOK: siFacebook.path,
  YOUTUBE: siYoutube.path,
};

export function BrandIcon({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={cn("size-5 shrink-0", className)}
    >
      <path d={PATHS[platform]} />
    </svg>
  );
}
