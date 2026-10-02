import { artworkSources, type ArtworkName } from "@/lib/artwork";
import { cn } from "@/lib/utils";

/**
 * The one way to show design artwork (characters, backgrounds, card art, trophy).
 * When docs/design/assets/<name>.png exists it renders the prebuilt responsive WebP variants with a PNG
 * fallback (see scripts/sync-art.mjs); otherwise a placeholder of the same size: surface #14141A, 1px
 * border #26262E and a faint gold glow. Size comes from the parent (`fill`, default) or from width/height.
 * Position the image inside its box with className (e.g. "object-right", "object-top").
 */
export function Artwork({
  name,
  alt = "",
  className,
  fit = "cover",
  width,
  height,
  priority,
  lowPriority,
  sizes = "100vw",
  placeholderBorder = true,
  layer = false,
}: {
  name: ArtworkName;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
  width?: number;
  height?: number;
  priority?: boolean;
  /** Decorative art over the page's LCP image: load right away but after it (fetchpriority=low). */
  lowPriority?: boolean;
  /** Rendered width hint for the srcset, as in <img sizes>. Fixed-size artwork uses its width. */
  sizes?: string;
  /** Background art inside a card already has the card's border. */
  placeholderBorder?: boolean;
  /**
   * Art stacked on top of other art (a character over its background). When missing, its
   * placeholder is transparent so the layer below still shows; the layer below is the placeholder.
   */
  layer?: boolean;
}) {
  const art = artworkSources(name);
  const fixed = width && height ? { width, height } : undefined;

  if (!art) {
    return (
      <div
        data-artwork={name}
        data-artwork-placeholder=""
        aria-hidden={alt ? undefined : true}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        style={fixed}
        className={cn(
          // Faint gold glow as a radial gradient: same look as a blurred inset shadow, far cheaper to paint.
          !layer &&
            "bg-surface bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(232,179,58,0.07))]",
          placeholderBorder && !layer && "border-border border",
          fixed ? "shrink-0" : "absolute inset-0",
          className,
        )}
      />
    );
  }

  return (
    <picture data-artwork-picture={name} className="contents">
      <source
        type="image/webp"
        srcSet={art.webpSrcSet}
        sizes={fixed ? `${fixed.width}px` : sizes}
      />
      <img
        data-artwork={name}
        src={art.png}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        width={fixed?.width ?? art.width}
        height={fixed?.height ?? art.height}
        loading={priority || lowPriority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : lowPriority ? "low" : undefined}
        decoding="async"
        className={cn(
          fit === "cover" ? "object-cover" : "object-contain",
          // Transparent art (characters, icons, trophy) must never get a box behind it.
          "bg-transparent",
          fixed ? "shrink-0" : "absolute inset-0 size-full",
          className,
        )}
        style={fixed}
      />
    </picture>
  );
}
