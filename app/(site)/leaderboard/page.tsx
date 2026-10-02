import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameCard } from "@/components/game/game-card";
import { GameBadge } from "@/components/game/game-badge";
import { PlaceIcon } from "@/components/leaderboard/rank-badge";
import { listPastSeasons } from "@/server/services/leaderboard";
import { GAME_LIST } from "@/lib/games";
import { formatDateIST } from "@/lib/time";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function LeaderboardIndexPage() {
  const past = await Promise.all(
    GAME_LIST.map(async (g) => ({ game: g, seasons: await listPastSeasons(g.id) })),
  );
  const anyPast = past.some((p) => p.seasons.length);
  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="One leaderboard per game; seasons reset every 3 months. Pick a game."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {GAME_LIST.map((g) => (
          <GameCard key={g.id} game={g.id} href={`/leaderboard/${g.slug}`} />
        ))}
      </div>

      {/* Target of the navbar's More → Past seasons. */}
      <section id="past-seasons" aria-labelledby="past-seasons-h" className="mt-10 scroll-mt-24">
        <h2 id="past-seasons-h" className="mb-3 text-xl font-bold">
          Past seasons
        </h2>
        {!anyPast ? (
          <p className="text-muted-foreground text-sm">
            This is the first season; final standings appear here when it ends.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {past.flatMap(({ game, seasons }) =>
              seasons.map((s) => (
                <li key={s.id} className="card-ds p-4">
                  <GameBadge game={game.id} />
                  <Link
                    href={`/leaderboard/${game.slug}/seasons/${s.id}`}
                    className="font-heading hover:text-gold mt-1 block text-lg uppercase"
                  >
                    {s.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {formatDateIST(s.startsAt)} – {formatDateIST(s.endsAt)}
                  </p>
                  <ol className="mt-2 space-y-1 text-sm">
                    {s.results.map((r) => (
                      <li key={r.id} className="flex items-center gap-2">
                        <PlaceIcon place={r.rank} />
                        {r.user.displayName ?? "Player"} — {r.points} pts
                      </li>
                    ))}
                  </ol>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
    </>
  );
}
