import { IntentLink as Link } from "@/components/common/intent-link";
import { ArrowRightIcon, CalendarDaysIcon, TicketIcon, TrophyIcon, UsersIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { GameBadge } from "@/components/game/game-badge";
import { artKey } from "@/lib/artwork";
import { GAME_CONFIG, GAME_LIST, type Game } from "@/lib/games";
import { tournamentFormatLabel } from "@/lib/home";
import { formatEntryFee, formatINR } from "@/lib/money";
import { shortDateIST, shortWeekdayIST } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { WeekTournament } from "@/server/queries/home";

/**
 * Tournament card (home-desktop.png): game badge, "Weekly Championship", prize pool, team size and date,
 * card art on the right, outlined "Register Now". A game without a tournament this week shows
 * "Announcing soon" and no button.
 */
function TournamentCard({
  game,
  tournament,
}: {
  game: Game;
  tournament: WeekTournament | undefined;
}) {
  const cfg = GAME_CONFIG[game];
  return (
    <article
      aria-label={`${cfg.name} weekly tournament`}
      data-empty={tournament ? undefined : "true"}
      className={cn(
        "card-ds-interactive relative isolate flex min-h-56 flex-col overflow-hidden p-4",
        cfg.accent.borderSoft,
      )}
    >
      <div className="absolute inset-y-0 right-0 -z-10 w-2/5">
        <Artwork
          name={`card-tournament-${artKey(game)}`}
          placeholderBorder={false}
          sizes="(min-width: 1280px) 170px, 35vw"
          className="object-right"
        />
        <span
          aria-hidden
          className="from-surface via-surface/30 absolute inset-0 bg-gradient-to-r to-transparent"
        />
      </div>
      <div className="flex items-start gap-2.5">
        <TrophyIcon aria-hidden className={cn("mt-0.5 size-7 shrink-0", cfg.accent.text)} />
        <div className="max-w-[60%] min-w-0">
          <GameBadge game={game} className="text-xl leading-tight" />
          <p className="text-muted-foreground text-xs">Weekly Championship</p>
        </div>
      </div>
      {tournament ? (
        <>
          <p className="font-heading mt-4 text-3xl leading-none font-extrabold">
            {formatINR(tournament.prizePoolPaise)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">Prize Pool</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <li className="flex items-center gap-1.5">
              <UsersIcon aria-hidden className={cn("size-4", cfg.accent.text)} />{" "}
              {tournamentFormatLabel(game, tournament.mode)}
            </li>
            <li className="flex items-center gap-1.5">
              <CalendarDaysIcon aria-hidden className={cn("size-4", cfg.accent.text)} />{" "}
              {shortWeekdayIST(tournament.startsAt)}, {shortDateIST(tournament.startsAt)}
            </li>
            <li className="flex items-center gap-1.5">
              <TicketIcon aria-hidden className={cn("size-4", cfg.accent.text)} />{" "}
              {tournament.entryFeePaise ? `Entry ${formatEntryFee(tournament.entryFeePaise)}` : "Free entry"}
            </li>
            {tournament.moreCount > 0 ? (
              <li className="text-gold font-medium">+{tournament.moreCount} more</li>
            ) : null}
          </ul>
          <div className="mt-auto pt-4">
            <Link
              href={`/tournament/${cfg.slug}`}
              className={cn(
                "min-h-tap bg-background/60 hover:bg-background inline-flex w-full items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors",
                cfg.accent.border,
              )}
            >
              {/* The label never promises more than the registration rules allow (DECISIONS H4). */}
              {tournament.registrationOpen ? "Register Now" : "View Tournament"}{" "}
              <ArrowRightIcon aria-hidden className="size-4" />
            </Link>
          </div>
        </>
      ) : (
        <p className="font-heading text-muted-foreground mt-auto pt-6 text-2xl uppercase">
          Announcing soon
        </p>
      )}
    </article>
  );
}

/** "This Week's Tournaments": one card per game (from real tournaments, or an "announced soon" card). */
export function WeekTournaments({ tournaments }: { tournaments: WeekTournament[] }) {
  return (
    <section aria-labelledby="week-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TrophyIcon aria-hidden className="text-gold size-7" />
        <div>
          <h2 id="week-heading" className="text-2xl font-bold sm:text-3xl">
            This Week&apos;s Tournaments
          </h2>
          <p className="text-muted-foreground text-xs">Bigger battles. Bigger rewards.</p>
        </div>
        <Link
          href="/tournament"
          className="min-h-tap text-gold hover:text-gold-hover ml-auto inline-flex items-center gap-1.5 text-sm font-medium"
        >
          View All <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="-mx-4 mt-3 flex snap-x scroll-px-4 [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:scroll-px-0 sm:grid-cols-3 sm:overflow-visible sm:px-0">
        {GAME_LIST.map((g) => (
          <li key={g.id} className="w-[80%] shrink-0 snap-start sm:w-auto">
            <TournamentCard game={g.id} tournament={tournaments.find((t) => t.game === g.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
