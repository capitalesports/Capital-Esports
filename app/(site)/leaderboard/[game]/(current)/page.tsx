import type { Metadata } from "next";
import { CrownIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { ShareButton } from "@/components/common/share-button";
import { PageHeader } from "@/components/common/page-header";
import { PlaceIcon } from "@/components/leaderboard/rank-badge";
import { StandingsTable, TiebreakNote } from "@/components/leaderboard/standings-table";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/session";
import { myStandingPage } from "@/server/queries/points";
import {
  getActiveSeason,
  getStandingsPage,
  LEADERBOARD_PAGE_SIZE,
  listPastSeasons,
} from "@/server/services/leaderboard";
import { gameFromSlug, GAME_CONFIG, isBattleRoyale } from "@/lib/games";
import { requireGameSlug } from "@/lib/params";
import { formatDateIST } from "@/lib/time";

export async function generateMetadata({
  params,
}: PageProps<"/leaderboard/[game]">): Promise<Metadata> {
  const game = gameFromSlug((await params).game);
  return game
    ? {
        title: `${GAME_CONFIG[game].name} leaderboard`,
        description: `Current season standings for ${GAME_CONFIG[game].name}.`,
      }
    : { title: "Leaderboard" };
}

export default async function GameLeaderboardPage({
  params,
  searchParams,
}: PageProps<"/leaderboard/[game]">) {
  const game = requireGameSlug((await params).game);
  const cfg = GAME_CONFIG[game];
  const page = Number((await searchParams).page ?? 1) || 1;
  const [season, past, user] = await Promise.all([
    getActiveSeason(game),
    listPastSeasons(game),
    getCurrentUser(),
  ]);
  const board = season ? await getStandingsPage(season.id, game, page) : null;
  const mine =
    user && season ? await myStandingPage(season.id, user.id, LEADERBOARD_PAGE_SIZE) : null;
  const br = isBattleRoyale(game);

  return (
    <>
      <PageHeader
        title={`${cfg.name} leaderboard`}
        icon={<CrownIcon aria-hidden />}
        tag={season ? "Current season" : undefined}
        description={
          season
            ? `${season.name}: ${formatDateIST(season.startsAt)} – ${formatDateIST(season.endsAt)}`
            : "No active season"
        }
      >
        {mine && user ? (
          <Button asChild variant="gold-outline">
            <Link
              href={`/leaderboard/${cfg.slug}${mine.page > 1 ? `?page=${mine.page}` : ""}#player-${user.id}`}
            >
              Your rank: #{mine.rank}
            </Link>
          </Button>
        ) : null}
        {mine && user ? (
          <ShareButton
            label="Share my rank"
            text={`I'm ranked #${mine.rank} on the ${cfg.name} leaderboard with ${mine.points} points!`}
            url={`/players/${user.id}?game=${cfg.slug}`}
          />
        ) : null}
      </PageHeader>
      {!board || board.total === 0 ? (
        <EmptyState
          art="empty-no-matches"
          title="No points yet this season"
          description="Play scrims to get on the board. Points post once a moderator approves results."
          action={{ href: `/scrims?game=${cfg.slug}`, label: `${cfg.name} scrims` }}
        />
      ) : (
        <div className="space-y-3">
          <StandingsTable rows={board.rows} battleRoyale={br} highlightUserId={user?.id} />
          <TiebreakNote battleRoyale={br} />
          {board.pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              {board.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={`/leaderboard/${cfg.slug}?page=${board.page - 1}`}>Previous</Link>
                </Button>
              ) : null}
              <span className="text-muted-foreground text-sm">
                Page {board.page} of {board.pages}
              </span>
              {board.page < board.pages ? (
                <Button asChild variant="outline">
                  <Link href={`/leaderboard/${cfg.slug}?page=${board.page + 1}`}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}

      <section aria-labelledby="past-h" className="mt-10">
        <h2 id="past-h" className="mb-3 text-xl font-bold">
          Past seasons &amp; champions
        </h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">This is the first season.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {past.map((s) => (
              <li key={s.id} className="card-ds p-4">
                <Link
                  href={`/leaderboard/${cfg.slug}/seasons/${s.id}`}
                  className="font-heading hover:text-gold text-lg uppercase"
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
                      <Link href={`/players/${r.user.id}`} className="hover:underline">
                        {r.user.displayName ?? "Player"}
                      </Link>{" "}
                      — {r.points} pts
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
