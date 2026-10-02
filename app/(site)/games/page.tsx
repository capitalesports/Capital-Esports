import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { GameCard } from "@/components/game/game-card";
import { GAME_LIST } from "@/lib/games";

export const metadata: Metadata = {
  title: "Games",
  description: "Free Fire, BGMI and Valorant: scrims, tournaments and leaderboards.",
};

export default function GamesIndexPage() {
  return (
    <>
      <PageHeader
        title="Games"
        description="Scrims, weekly tournaments and a season leaderboard for each game."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {GAME_LIST.map((g) => (
          <GameCard key={g.id} game={g.id} href={`/games/${g.slug}`} />
        ))}
      </div>
    </>
  );
}
