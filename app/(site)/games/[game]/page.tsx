import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { GameBadge } from "@/components/game/game-badge";
import { MatchCard } from "@/components/match/match-card";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { paymentsEnabled } from "@/server/env";
import { listUpcomingScrims } from "@/server/queries/matches";
import { topPlayers } from "@/server/queries/points";
import { gameFromSlug, GAME_CONFIG, type Game } from "@/lib/games";
import { isHeadToHead, MODE_LABEL, MODES_FOR_GAME } from "@/lib/match-modes";
import { formatINR } from "@/lib/money";

/** In-game name of the head-to-head custom room mode. */
const H2H_NAME: Record<Game, string | null> = {
  FREE_FIRE: "Clash Squad",
  BGMI: "TDM",
  VALORANT: null,
};
import { requireGameSlug } from "@/lib/params";
import { startOfIstDay } from "@/lib/time";

export async function generateMetadata({ params }: PageProps<"/games/[game]">): Promise<Metadata> {
  const game = gameFromSlug((await params).game);
  if (!game) return { title: "Game not found" };
  const name = GAME_CONFIG[game].name;
  return {
    title: `${name} scrims, tournament & leaderboard`,
    description: `Daily ${name} scrims, this week's ${name} tournament and the season leaderboard.`,
  };
}

export default async function GamePage({ params }: PageProps<"/games/[game]">) {
  const game = requireGameSlug((await params).game);
  const cfg = GAME_CONFIG[game];
  const lobbyModes = MODES_FOR_GAME[game].filter((m) => !isHeadToHead(m));
  const h2hModes = MODES_FOR_GAME[game].filter(isHeadToHead);
  const now = new Date();
  const [scrims, top, tournament] = await Promise.all([
    listUpcomingScrims({ game }, now),
    topPlayers(game, 10),
    db.tournament.findFirst({
      where: { game, weekOf: { lte: startOfIstDay(now, 1) } },
      orderBy: { weekOf: "desc" },
      select: { title: true, prizePoolPaise: true, format: true, weekOf: true },
    }),
  ]);

  return (
    <div className="py-6">
      <div className={`rounded-2xl border-2 ${cfg.accent.border} bg-card p-6`}>
        <GameBadge game={game} />
        <h1 className="mt-3 text-3xl font-extrabold">{cfg.name}</h1>
        <p className="text-muted-foreground mt-1">{cfg.platform}</p>
        <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
          {lobbyModes.length ? (
            <li>
              {lobbyModes.map((m) => MODE_LABEL[m]).join(", ")} lobbies: placement + kill points
            </li>
          ) : null}
          <li>
            {h2hModes.map((m) => MODE_LABEL[m]).join(", ")}
            {H2H_NAME[game] ? ` (${H2H_NAME[game]})` : ""}: head-to-head, win-based points (round
            difference breaks ties)
          </li>
        </ul>
      </div>

      <section aria-labelledby="scrims-h" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="scrims-h" className="text-xl font-bold">
            Scrims
          </h2>
          <Link
            href={`/scrims?game=${cfg.slug}`}
            className="min-h-tap text-primary inline-flex items-center text-sm hover:underline"
          >
            All {cfg.name} scrims
          </Link>
        </div>
        {scrims.length === 0 ? (
          <EmptyState
            title={`No ${cfg.name} scrims scheduled`}
            description="New scrims are added daily."
            action={{ href: "/scrims", label: "See all games" }}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scrims.slice(0, 6).map((m) => (
              <MatchCard key={m.id} match={m} paymentsEnabled={paymentsEnabled()} now={now} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="tournament-h" className="card-ds p-4">
          <h2 id="tournament-h" className="text-xl font-bold">
            This week&apos;s tournament
          </h2>
          {tournament ? (
            <div className="mt-2 space-y-1">
              <p className="font-semibold">{tournament.title}</p>
              <p className="text-muted-foreground text-sm">
                Prize pool {formatINR(tournament.prizePoolPaise)}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              The first {cfg.name} tournament is coming soon.
            </p>
          )}
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/tournament/${cfg.slug}`}>Tournament details</Link>
          </Button>
        </section>
        <section aria-labelledby="lb-h" className="card-ds p-4">
          <h2 id="lb-h" className="text-xl font-bold">
            Leaderboard top 10
          </h2>
          {top.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              No points yet this season. Play a scrim to get on the board.
            </p>
          ) : (
            <ol className="mt-2 space-y-1">
              {top.map((p) => (
                <li key={p.userId} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="text-muted-foreground inline-block w-6">{p.rank}</span>
                    {p.name}
                  </span>
                  <span className="font-semibold">{p.points}</span>
                </li>
              ))}
            </ol>
          )}
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/leaderboard/${cfg.slug}`}>Full leaderboard</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
