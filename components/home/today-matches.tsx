"use client";

import { useRef, useState } from "react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { ArrowRightIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { GAME_CONFIG, GAME_LIST, type Game } from "@/lib/games";
import { chipClass } from "@/lib/ui";

export interface TodayCard {
  id: string;
  game: Game;
  card: React.ReactNode;
}

const arrowClass =
  "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-gold hover:text-gold xl:flex";

/** Empty row: "No matches open right now — see all scrims" (for the chosen game when a chip is active). */
function NoMatches({ game }: { game: Game | null }) {
  const cfg = game ? GAME_CONFIG[game] : null;
  const href = cfg ? `/scrims?game=${cfg.slug}` : "/scrims";
  return (
    <div className="card-ds flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
      <div className="relative size-16 shrink-0">
        <Artwork name="empty-no-matches" fit="contain" sizes="64px" />
      </div>
      <p className="flex-1 font-semibold">
        No {cfg ? `${cfg.name} ` : ""}matches open right now —{" "}
        <Link
          href={href}
          className="text-gold hover:text-gold-hover underline-offset-4 hover:underline"
        >
          see all scrims
        </Link>
      </p>
    </div>
  );
}

/**
 * "Open & Upcoming Matches" row (owner's request, replaces the design's "Today's Matches"): every
 * match whose registration is open or coming up, soonest first, with game chips and a scrolling row.
 */
export function TodayMatches({ cards }: { cards: TodayCard[] }) {
  const [game, setGame] = useState<Game | null>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const visible = game ? cards.filter((c) => c.game === game) : cards;
  const scroll = (dir: 1 | -1) =>
    rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: "smooth" });
  const options = [
    { id: null, label: "All Games" },
    ...GAME_LIST.map((g) => ({ id: g.id, label: g.name })),
  ];

  return (
    <section aria-labelledby="today-heading">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <CalendarDaysIcon aria-hidden className="text-gold size-7" />
        <h2 id="today-heading" className="text-2xl font-bold sm:text-3xl">
          Open &amp; Upcoming Matches
        </h2>
        <p className="text-muted-foreground hidden text-sm md:block">
          Registration open now, and what&apos;s coming up. Don&apos;t miss out!
        </p>
        <div className="flex w-full flex-wrap items-center gap-3 lg:ml-auto lg:w-auto">
          <Link
            href="/scrims"
            className="min-h-tap text-gold hover:text-gold-hover inline-flex items-center gap-1.5 text-sm font-medium"
          >
            View All Matches <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
          <div
            role="group"
            aria-label="Filter open and upcoming matches by game"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
          >
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={game === o.id}
                onClick={() => setGame(o.id)}
                className={`${chipClass(game === o.id)} shrink-0`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative mt-4">
        {visible.length === 0 ? (
          <NoMatches game={game} />
        ) : (
          <>
            <button
              type="button"
              aria-label="Scroll matches left"
              onClick={() => scroll(-1)}
              className={`${arrowClass} -left-14`}
            >
              <ChevronLeftIcon aria-hidden className="size-5" />
            </button>
            <ul
              ref={rowRef}
              aria-label="Open and upcoming matches"
              className="-mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0"
            >
              {visible.map((c) => (
                <li
                  key={c.id}
                  className="w-[85%] shrink-0 snap-start sm:w-80 lg:w-[calc((100%-3rem)/4)]"
                >
                  {c.card}
                </li>
              ))}
            </ul>
            <button
              type="button"
              aria-label="Scroll matches right"
              onClick={() => scroll(1)}
              className={`${arrowClass} -right-14`}
            >
              <ChevronRightIcon aria-hidden className="size-5" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
