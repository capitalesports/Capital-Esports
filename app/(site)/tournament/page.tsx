import { Suspense } from "react";
import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { GameCard } from "@/components/game/game-card";
import { listUpcomingTournaments } from "@/server/services/tournament-queries";
import { GAME_CONFIG, GAME_LIST } from "@/lib/games";
import { gameModeLabel } from "@/lib/home";
import { formatEntryFee, formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tournament" };

export default function TournamentIndexPage() {
  return (
    <>
      <PageHeader
        title="Tournament"
        description="Weekly tournaments for every game. Pick a game."
      />
      <Suspense>
        <UpcomingTournaments />
      </Suspense>
      <div className="grid gap-4 sm:grid-cols-3">
        {GAME_LIST.map((g) => (
          <GameCard key={g.id} game={g.id} href={`/tournament/${g.slug}`} />
        ))}
      </div>
    </>
  );
}

/** Tournaments with registration open or opening later, across every game. */
async function UpcomingTournaments() {
  const list = await listUpcomingTournaments();
  if (!list.length) return null;
  return (
    <section aria-labelledby="upcoming-h" className="mb-8 space-y-3">
      <h2 id="upcoming-h" className="text-xl font-bold">
        Upcoming tournaments
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => {
          const cfg = GAME_CONFIG[t.game];
          const open = t.entry.status === "REGISTRATION_OPEN";
          return (
            <li key={t.id}>
              <Link
                href={`/tournament/${cfg.slug}?t=${t.id}`}
                className={cn("card-ds-interactive block space-y-3 p-4", cfg.accent.borderSoft)}
              >
                <div className="flex items-center gap-2">
                  <GameBadge game={t.game} />
                  <span className="text-muted-foreground text-sm">
                    {gameModeLabel(t.game, t.mode)}
                  </span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
                      open ? "bg-success/15 text-success" : "bg-gold/15 text-gold",
                    )}
                  >
                    {open ? "Registration open" : "Coming soon"}
                  </span>
                </div>
                <h3 className="text-lg font-bold">{t.title}</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Prize pool</dt>
                  <dd className="text-gold font-semibold">{formatINR(t.prizePoolPaise)}</dd>
                  <dt className="text-muted-foreground">Entry</dt>
                  <dd>{formatEntryFee(t.entry.entryFeePaise)}</dd>
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd>{formatIST(t.startsAt)}</dd>
                  <dt className="text-muted-foreground">
                    {open ? "Registration closes" : "Registration opens"}
                  </dt>
                  <dd>
                    {open
                      ? formatIST(t.entry.registrationClosesAt)
                      : t.entry.registrationOpensAt
                        ? formatIST(t.entry.registrationOpensAt)
                        : "Soon"}
                  </dd>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
