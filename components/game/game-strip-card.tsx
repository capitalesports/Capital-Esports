import { ArrowRightIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { IntentLink as Link } from "@/components/common/intent-link";
import { artKey } from "@/lib/artwork";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { cn } from "@/lib/utils";

/**
 * Wide game card from the designs' game strip (home and /scrims): banner art on the left, game name and
 * subtitle on the right, border in the game accent. `selected` brightens the border (/scrims filter);
 * `arrow` adds the round arrow button (home).
 */
export function GameStripCard({
  game,
  href,
  subtitle,
  selected = false,
  arrow = false,
  scroll,
}: {
  game: Game;
  href: string;
  subtitle: string;
  selected?: boolean;
  arrow?: boolean;
  scroll?: boolean;
}) {
  const cfg = GAME_CONFIG[game];
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      scroll={scroll}
      className={cn(
        "group bg-surface relative isolate flex min-h-20 items-center overflow-hidden rounded-xl border transition-[border-color,box-shadow] sm:min-h-24",
        selected
          ? cn(
              "border-2",
              cfg.accent.border,
              "shadow-[0_0_24px_-6px_currentColor]",
              cfg.accent.text,
            )
          : cfg.accent.borderSoft,
        !selected && "hover:border-gold",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 -z-10 w-1/2">
        <Artwork
          name={`banner-${artKey(game)}`}
          placeholderBorder={false}
          sizes="(min-width: 1280px) 220px, 50vw"
          className="object-right"
        />
      </span>
      <span
        aria-hidden
        className="via-surface/70 to-surface absolute inset-0 -z-10 bg-gradient-to-r from-transparent"
      />
      <span className="text-foreground ml-auto flex w-3/5 items-center gap-3 py-3 pr-4">
        <span className="min-w-0 flex-1">
          <span className="font-heading block text-2xl leading-none font-extrabold tracking-wide uppercase">
            {cfg.name}
          </span>
          <span className="text-muted-foreground mt-1 block text-sm">{subtitle}</span>
        </span>
        {arrow ? (
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-transform group-hover:translate-x-1",
              cfg.accent.border,
            )}
          >
            <ArrowRightIcon className="size-4" />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
