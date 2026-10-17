import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { GameCard } from "@/components/game/game-card";
import { TournamentCard } from "@/components/tournament/tournament-card";
import { listUpcomingTournaments } from "@/server/services/tournament-queries";
import { GAME_CONFIG, GAME_LIST } from "@/lib/games";

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
        {list.map((t) => (
          <li key={t.id}>
            <TournamentCard t={t} href={`/tournament/${GAME_CONFIG[t.game].slug}?t=${t.id}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
