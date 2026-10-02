"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, TrophyIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PlayerAvatar } from "@/components/common/player-avatar";
import { GameBadge } from "@/components/game/game-badge";
import { PLACE_LABEL, PlaceIcon } from "@/components/leaderboard/rank-badge";
import { Button } from "@/components/ui/button";
import { artKey } from "@/lib/artwork";
import { CAROUSEL_INTERVAL_MS, isPaused, scheduleAdvance, wrapIndex } from "@/lib/carousel";
import { GAME_CONFIG } from "@/lib/games";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { WinnerSlide } from "@/server/queries/home";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION);
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** One tournament's podium, in the "This Week's Tournaments" card style. */
function WinnerCard({ slide, active }: { slide: WinnerSlide; active: boolean }) {
  const cfg = GAME_CONFIG[slide.game];
  const [champion, ...rest] = slide.podium;
  return (
    <div
      className={cn(
        "card-ds relative isolate flex h-full min-h-56 flex-col overflow-hidden p-4 sm:p-5",
        cfg.accent.borderSoft,
      )}
    >
      <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-2/5">
        <Artwork
          name={`card-tournament-${artKey(slide.game)}`}
          placeholderBorder={false}
          sizes="(min-width: 1024px) 520px, 40vw"
          className="object-right"
        />
        <span className="from-surface via-surface/30 absolute inset-0 bg-gradient-to-r to-transparent" />
      </div>
      <div className="flex items-start gap-2.5">
        <TrophyIcon aria-hidden className={cn("mt-0.5 size-7 shrink-0", cfg.accent.text)} />
        <div className="min-w-0">
          <GameBadge game={slide.game} className="text-xl leading-tight" />
          <p className="text-muted-foreground truncate text-xs">{slide.title}</p>
        </div>
      </div>
      <div className="mt-4 grid max-w-[60%] gap-4 lg:grid-cols-2 lg:items-center">
        {champion ? (
          <div className="flex items-center gap-3">
            <PlayerAvatar
              name={champion.name}
              src={champion.avatarUrl}
              size={56}
              className="border-gold"
            />
            <div className="min-w-0">
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <PlaceIcon place={1} /> {PLACE_LABEL[0]}
              </p>
              <p className="font-heading truncate text-3xl leading-none font-extrabold uppercase">
                {champion.name}
              </p>
              {champion.prizePaise ? (
                <p className="text-gold text-sm">{formatINR(champion.prizePaise)}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {rest.length ? (
          <ul className="sm:border-border space-y-2 text-sm sm:border-l sm:pl-4">
            {rest.map((w) => (
              <li key={w.place} className="flex flex-wrap items-center gap-x-2">
                <PlaceIcon place={w.place} />
                <span className="text-muted-foreground">
                  {PLACE_LABEL[w.place - 1] ?? `#${w.place}`}:
                </span>
                <span className="font-medium">{w.name}</span>
                {w.prizePaise ? (
                  <span className="text-muted-foreground">· {formatINR(w.prizePaise)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-auto pt-3">
        <Link
          href={`/tournament/${cfg.slug}/past#${slide.tournamentId}`}
          tabIndex={active ? 0 : -1}
          className="min-h-tap text-gold hover:text-gold-hover inline-flex items-center text-sm font-medium"
        >
          Full results
        </Link>
      </div>
    </div>
  );
}

/**
 * "Last Week's Winners": the latest published podium per game. Advances every 7 s, pauses while hovered,
 * touched or focused, never auto-advances with prefers-reduced-motion, and has dots and arrows (plus
 * arrow keys). Rendered only when there is at least one published result.
 */
export function WinnersCarousel({
  slides,
  intervalMs = CAROUSEL_INTERVAL_MS,
}: {
  slides: WinnerSlide[];
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const count = slides.length;
  const paused = isPaused({ hovered, touched, focused, reducedMotion: reduced });

  const go = useCallback((i: number) => setIndex(wrapIndex(i, 0, count)), [count]);

  useEffect(
    () =>
      scheduleAdvance({
        count,
        paused,
        intervalMs,
        onAdvance: () => setIndex((i) => wrapIndex(i, 1, count)),
        // Re-checked when the timer fires: the first render's timer can run before `reduced` is known.
        stillAllowed: () => !window.matchMedia(REDUCED_MOTION).matches,
      }),
    [index, paused, count, intervalMs],
  );

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Tournament winners"
      data-index={index}
      data-paused={paused}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTouched(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className="overflow-hidden rounded-xl">
        <div
          className={cn("flex", reduced ? "" : "transition-transform duration-500 ease-out")}
          style={{ transform: `translateX(-${index * 100}%)` }}
          aria-live={paused ? "polite" : "off"}
        >
          {slides.map((s, i) => (
            <div
              key={s.tournamentId}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
              className="w-full shrink-0"
            >
              <WinnerCard slide={s} active={i === index} />
            </div>
          ))}
        </div>
      </div>
      {count > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous slide"
            onClick={() => go(index - 1)}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <div className="flex items-center gap-1">
            {slides.map((s, i) => (
              <button
                key={s.tournamentId}
                type="button"
                aria-label={`Show slide ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => go(i)}
                className="flex size-11 items-center justify-center"
              >
                <span
                  className={cn(
                    "block size-2.5 rounded-full transition-colors",
                    i === index ? "bg-gold" : "bg-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" aria-label="Next slide" onClick={() => go(index + 1)}>
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
