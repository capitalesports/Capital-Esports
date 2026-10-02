import { IntentLink as Link } from "@/components/common/intent-link";
import {
  ArrowRightIcon,
  CoinsIcon,
  PlayIcon,
  TrophyIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { Button } from "@/components/ui/button";
import { artKey } from "@/lib/artwork";
import { GAME_CONFIG, GAME_LIST, type Game } from "@/lib/games";
import { todayCountLabel, type HomeStat } from "@/lib/home";
import { BRAND_ACCENT, BRAND_REST, SITE_TAGLINE } from "@/lib/site";
import { cn } from "@/lib/utils";

const STAT_ICON: Record<HomeStat["key"], LucideIcon> = {
  players: UserIcon,
  tournaments: TrophyIcon,
  prize: CoinsIcon,
};

function HeroPanel({
  game,
  todayCount,
  tagline,
  index,
}: {
  game: Game;
  todayCount: number;
  tagline: string[];
  index: number;
}) {
  const cfg = GAME_CONFIG[game];
  const key = artKey(game);
  return (
    <Link
      href={`/games/${cfg.slug}`}
      aria-label={`${cfg.name}: ${tagline.join(", ")}. ${todayCountLabel(todayCount)}`}
      className="hero-panel group border-border relative isolate flex h-56 w-[72%] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-xl border pb-4 text-center focus-visible:outline-none sm:h-72 sm:w-[45%] lg:h-auto lg:w-auto lg:min-w-0 lg:flex-1 lg:rounded-none lg:border-0"
    >
      <Artwork
        name={`bg-${key}`}
        placeholderBorder={false}
        sizes="(min-width: 1024px) 340px, 72vw"
        priority={index === 0}
        className="-z-20"
      />
      <Artwork
        name={`hero-${key}`}
        layer
        sizes="(min-width: 1024px) 340px, 72vw"
        lowPriority={index === 0}
        className="-z-10 origin-top object-top transition-transform duration-500 group-hover:scale-[1.03]"
      />
      <span
        aria-hidden
        className="from-background via-background/30 absolute inset-0 -z-10 bg-gradient-to-t to-transparent"
      />
      <span
        aria-hidden
        className="ring-gold absolute inset-0 -z-10 opacity-0 ring-2 transition-opacity ring-inset group-hover:opacity-100 group-focus-visible:opacity-100"
      />
      <span className="font-heading text-foreground px-4 text-3xl leading-none font-extrabold tracking-wide uppercase italic lg:px-[var(--slant)] lg:text-4xl">
        {cfg.name}
      </span>
      <span className="mt-2 px-4 text-xs leading-snug tracking-wide uppercase sm:text-sm lg:px-[var(--slant)]">
        {tagline.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
      <span className={cn("mt-1 px-4 text-xs font-medium lg:px-[var(--slant)]", cfg.accent.text)}>
        {todayCountLabel(todayCount)}
      </span>
    </Link>
  );
}

export function HomeHero({
  stats,
  todayByGame,
  getStartedHref,
  trailerUrl,
  taglines,
}: {
  stats: HomeStat[];
  todayByGame: Record<Game, number>;
  getStartedHref: string;
  /** Admin → Content → Home page; the button is hidden when empty. */
  trailerUrl: string | null;
  taglines: Record<Game, string[]>;
}) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="grid grid-cols-1 gap-6 pt-6 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-0 lg:pt-4"
    >
      <div className="relative z-10 flex flex-col justify-center lg:py-8 lg:pr-4">
        <p className="font-heading text-gold text-sm font-bold tracking-[0.2em] uppercase sm:text-base">
          India&apos;s biggest esports platform
        </p>
        {/* The brand as the hero heading (DECISIONS M30). */}
        <h1
          id="hero-heading"
          className="font-heading mt-1 text-6xl leading-[0.88] font-extrabold uppercase sm:text-7xl"
        >
          <span className="block">{BRAND_ACCENT}</span>
          <span className="text-gold block">{BRAND_REST}</span>
        </h1>
        <p className="text-foreground mt-4 text-sm">{SITE_TAGLINE}</p>
        {stats.length ? (
          <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-4">
            {stats.map((s) => {
              const Icon = STAT_ICON[s.key];
              return (
                <div key={s.key} className="grid grid-cols-[auto_1fr] items-center gap-x-2.5">
                  <dt className="text-muted-foreground col-start-2 row-start-2 mt-0.5 text-xs">
                    {s.label}
                  </dt>
                  <dd className="col-start-1 row-span-2 row-start-1">
                    <Icon aria-hidden className="text-gold size-6" />
                  </dd>
                  <dd className="font-heading col-start-2 row-start-1 text-xl leading-none font-bold">
                    {s.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={getStartedHref}>
              Get Started <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
          {trailerUrl ? (
            <Button asChild size="lg" variant="outline">
              <a href={trailerUrl} target="_blank" rel="noopener noreferrer">
                <PlayIcon aria-hidden className="fill-current" /> Watch Trailer
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {/* Phones: a sideways-scrolling row of cards. Desktop: three slanted panels (.hero-panel in globals.css). */}
      <div
        aria-label="Games"
        role="group"
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 [--slant:3rem] lg:mx-0 lg:min-h-[19rem] lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {GAME_LIST.map((g, i) => (
          <HeroPanel
            key={g.id}
            game={g.id}
            index={i}
            todayCount={todayByGame[g.id] ?? 0}
            tagline={taglines[g.id]}
          />
        ))}
      </div>
    </section>
  );
}
