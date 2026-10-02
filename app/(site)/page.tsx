import { Suspense } from "react";
import { GameStripCard } from "@/components/game/game-strip-card";
import { HomeHero } from "@/components/home/hero";
import { LeaderboardPreview } from "@/components/home/leaderboard-preview";
import { TodayMatches } from "@/components/home/today-matches";
import { WeekTournaments } from "@/components/home/week-tournaments";
import { WhyPlay } from "@/components/home/why-play";
import { WinnersCarousel } from "@/components/home/winners-carousel";
import { StandingsTable } from "@/components/leaderboard/standings-table";
import { MatchCard } from "@/components/match/match-card";
import { getCurrentUser } from "@/server/auth/session";
import { paymentsEnabled } from "@/server/env";
import {
  getHomeStats,
  getLatestWinners,
  getLeaderboardPreview,
  getOpenAndUpcomingMatches,
  getTodayMatches,
  getWeekTournaments,
} from "@/server/queries/home";
import { getHomeSettings } from "@/server/services/content";
import { GAME_LIST, GAMES, isBattleRoyale, type Game } from "@/lib/games";
import { heroTagline, resolveHeroStats } from "@/lib/home";

/** Game strip subtitles on the home page (home-desktop.png). */
const STRIP_SUBTITLE: Record<Game, string> = {
  FREE_FIRE: "Daily Scrims & Tournaments",
  BGMI: "Daily Scrims & Tournaments",
  VALORANT: "Competitive 1v1, 2v2 & 5v5",
};

/** Home per docs/design/pages/home-desktop.png, sections top to bottom. */
export default async function HomePage() {
  const now = new Date();
  const [user, settings, today, upcoming, tournaments, boards, winners] = await Promise.all([
    getCurrentUser(),
    getHomeSettings(),
    getTodayMatches(now),
    getOpenAndUpcomingMatches(now),
    getWeekTournaments(now),
    getLeaderboardPreview(),
    getLatestWinners(),
  ]);
  // Live counts only when an admin switched "Use live stats" on; otherwise the admin's text is shown.
  const live = settings.liveStats ? await getHomeStats() : null;
  const todayByGame = Object.fromEntries(
    GAMES.map((g) => [g, today.filter((m) => m.game === g).length]),
  ) as Record<Game, number>;
  const taglines = Object.fromEntries(GAMES.map((g) => [g, heroTagline(settings, g)])) as Record<
    Game,
    string[]
  >;
  const payments = paymentsEnabled();

  return (
    <div className="space-y-10 pb-6 lg:space-y-12">
      <HomeHero
        stats={resolveHeroStats(settings, live)}
        todayByGame={todayByGame}
        getStartedHref={user ? "/dashboard" : "/login?returnTo=%2Fdashboard"}
        trailerUrl={settings.trailerUrl}
        taglines={taglines}
      />

      <nav aria-label="Games" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {GAME_LIST.map((g) => (
          <GameStripCard
            key={g.id}
            game={g.id}
            href={`/games/${g.slug}`}
            subtitle={STRIP_SUBTITLE[g.id]}
            arrow
          />
        ))}
      </nav>

      {/* Nothing below suspends: the boundaries only let React hydrate each section as its own task. */}
      <Suspense>
        <TodayMatches
          cards={upcoming.map((m) => ({
            id: m.id,
            game: m.game,
            card: <MatchCard match={m} paymentsEnabled={payments} now={now} />,
          }))}
        />
      </Suspense>

      <Suspense>
        <WeekTournaments tournaments={tournaments} />
      </Suspense>

      {/* Not in the design: shown only once a tournament has published winners (DECISIONS H3). No Suspense
          boundary here: the auto-advance timer should start when the page hydrates, not in a later pass. */}
      {winners.length ? (
        <section aria-labelledby="winners-heading">
          <h2 id="winners-heading" className="mb-3 text-2xl font-bold sm:text-3xl">
            Last Week&apos;s Winners
          </h2>
          <WinnersCarousel slides={winners} />
        </section>
      ) : null}

      <Suspense>
        <LeaderboardPreview
          panels={GAME_LIST.map((g) => ({
            slug: g.slug,
            name: g.name,
            table: boards[g.id].length ? (
              <StandingsTable
                rows={boards[g.id]}
                battleRoyale={isBattleRoyale(g.id)}
                highlightUserId={user?.id}
                compact
              />
            ) : (
              <p className="card-ds text-muted-foreground p-6 text-center text-sm">
                No points yet this season. Play {g.name} scrims to get on the board.
              </p>
            ),
          }))}
        />
      </Suspense>

      <Suspense>
        <WhyPlay />
      </Suspense>
    </div>
  );
}
