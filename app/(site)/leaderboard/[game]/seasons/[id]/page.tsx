import type { Metadata } from "next";
import { TrophyIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { StandingsTable, TiebreakNote } from "@/components/leaderboard/standings-table";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { getStandingsPage } from "@/server/services/leaderboard";
import { GAME_CONFIG, isBattleRoyale } from "@/lib/games";
import { requireGameSlug } from "@/lib/params";
import { formatDateIST } from "@/lib/time";

export const metadata: Metadata = { title: "Season standings" };

export default async function SeasonLeaderboardPage({
  params,
  searchParams,
}: PageProps<"/leaderboard/[game]/seasons/[id]">) {
  const { game: slug, id } = await params;
  const game = requireGameSlug(slug);
  const season = await db.season.findUnique({ where: { id } });
  if (!season || season.game !== game) notFound();
  const page = Number((await searchParams).page ?? 1) || 1;
  const board = await getStandingsPage(season.id, game, page);
  const cfg = GAME_CONFIG[game];

  return (
    <>
      <PageHeader
        title={`${cfg.name} — ${season.name}`}
        icon={<TrophyIcon aria-hidden />}
        tag={season.isActive ? "Current season" : "Final standings"}
        description={`${formatDateIST(season.startsAt)} – ${formatDateIST(season.endsAt)}${season.isActive ? " (current)" : " (final standings)"}`}
      >
        <Button asChild variant="outline">
          <Link href={`/leaderboard/${cfg.slug}`}>Current season</Link>
        </Button>
      </PageHeader>
      {board.total === 0 ? (
        <p className="text-muted-foreground">No points were scored in this season.</p>
      ) : (
        <div className="space-y-3">
          <StandingsTable rows={board.rows} battleRoyale={isBattleRoyale(game)} />
          <TiebreakNote battleRoyale={isBattleRoyale(game)} />
          {board.pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              {board.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={`?page=${board.page - 1}`}>Previous</Link>
                </Button>
              ) : null}
              <span className="text-muted-foreground text-sm">
                Page {board.page} of {board.pages}
              </span>
              {board.page < board.pages ? (
                <Button asChild variant="outline">
                  <Link href={`?page=${board.page + 1}`}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
