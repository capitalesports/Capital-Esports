import { IntentLink as Link } from "@/components/common/intent-link";
import { Artwork } from "@/components/common/artwork";
import { artworkSources } from "@/lib/artwork";
import { BRAND_ACCENT, BRAND_REST, SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

const MARK_HEIGHT = 28;

/**
 * Brand as in the designs: the "E" mark (logo.png, trimmed at build) followed by the wordmark as styled
 * text. logo.png is a gold mark on an opaque black square; `mix-blend-lighten` lets that black merge into
 * the dark UI (the site is dark only), so no box shows. Without the file: text only, gold first letter.
 */
export function BrandWordmark({
  className,
  textClassName,
}: {
  className?: string;
  textClassName?: string;
}) {
  const mark = artworkSources("logo");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark ? (
        <Artwork
          name="logo"
          width={Math.round((MARK_HEIGHT * mark.width) / mark.height)}
          height={MARK_HEIGHT}
          priority
          className="mix-blend-lighten"
        />
      ) : null}
      <span
        className={cn(
          // Phones: the two words stacked, so the header keeps room for its buttons; one line from sm.
          "font-heading text-[15px] leading-[0.95] font-extrabold tracking-wide whitespace-nowrap uppercase italic sm:text-2xl sm:leading-normal",
          textClassName,
        )}
      >
        <span className="text-gold block sm:inline">{BRAND_ACCENT}</span>
        <span className="hidden sm:inline"> </span>
        <span className="block sm:inline">{BRAND_REST}</span>
      </span>
    </span>
  );
}

/** Navbar logo linking home. */
export function BrandLogo() {
  return (
    <Link
      href="/"
      aria-label={`${SITE_NAME} home`}
      className="min-h-tap relative mr-4 flex shrink-0 items-center"
    >
      <BrandWordmark />
    </Link>
  );
}
