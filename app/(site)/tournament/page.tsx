import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { GameCard } from "@/components/game/game-card";
import { GAME_LIST } from "@/lib/games";

export const metadata: Metadata = { title: "Tournament" };

export default function TournamentIndexPage() {
  return (
    <>
      <PageHeader
        title="Tournament"
        description="Weekly tournaments for every game, one per mode. Pick a game."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {GAME_LIST.map((g) => (
          <GameCard key={g.id} game={g.id} href={`/tournament/${g.slug}`} />
        ))}
      </div>
    </>
  );
}
