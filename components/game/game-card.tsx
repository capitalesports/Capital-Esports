import { IntentLink as Link } from "@/components/common/intent-link";
import { ArrowRightIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { artKey } from "@/lib/artwork";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { cn } from "@/lib/utils";

const TAGLINE: Record<Game, string> = {
  FREE_FIRE: "Daily Scrims & Tournaments",
  BGMI: "Daily Scrims & Tournaments",
  VALORANT: "Competitive 1v1, 2v2 & 5v5",
};

/** Game strip card (design: banner art, game name in its accent, tagline, round arrow). */
export function GameCard({ game, href, meta }: { game: Game; href: string; meta?: string }) {
  const cfg = GAME_CONFIG[game];
  return (
    <Link
      href={href}
      className={cn(
        "group bg-surface relative flex min-h-24 items-center overflow-hidden rounded-xl border transition-colors sm:min-h-28",
        cfg.accent.borderSoft,
        "hover:border-gold",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1/2">
        <Artwork
          name={`banner-${artKey(game)}`}
          placeholderBorder={false}
          sizes="(min-width: 640px) 220px, 50vw"
          className="object-right"
        />
      </span>
      <span
        aria-hidden
        className="via-surface/70 to-surface absolute inset-0 bg-gradient-to-r from-transparent"
      />
      <span className="relative ml-auto flex w-full items-center gap-3 px-5 py-4 sm:w-3/5">
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "font-heading block text-2xl leading-none font-extrabold tracking-wide uppercase",
              cfg.accent.text,
            )}
          >
            {cfg.name}
          </span>
          <span className="text-foreground mt-1 block text-sm">{TAGLINE[game]}</span>
          {meta ? <span className="text-muted-foreground mt-0.5 block text-xs">{meta}</span> : null}
        </span>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-transform group-hover:translate-x-1",
            cfg.accent.border,
          )}
        >
          <ArrowRightIcon aria-hidden className="size-4" />
        </span>
      </span>
    </Link>
  );
}
