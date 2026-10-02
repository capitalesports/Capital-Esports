import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { WinnersList } from "@/components/tournament/winners-list";
import { listPastTournaments } from "@/server/services/tournament-queries";
import type { PublishedWinner } from "@/server/services/tournaments";
import { gameFromSlug, GAME_CONFIG } from "@/lib/games";
import { MODE_LABEL } from "@/lib/match-modes";
import { formatINR } from "@/lib/money";
import { requireGameSlug } from "@/lib/params";
import { formatDateIST } from "@/lib/time";

export async function generateMetadata({
  params,
}: PageProps<"/tournament/[game]/past">): Promise<Metadata> {
  const game = gameFromSlug((await params).game);
  return { title: game ? `Past ${GAME_CONFIG[game].name} tournaments` : "Past tournaments" };
}

export default async function PastTournamentsPage({
  params,
}: PageProps<"/tournament/[game]/past">) {
  const game = requireGameSlug((await params).game);
  const cfg = GAME_CONFIG[game];
  const tournaments = await listPastTournaments(game);
  return (
    <>
      <PageHeader
        title={`Past ${cfg.name} tournaments`}
        description="Archive of weekly events and their champions."
      />
      {tournaments.length === 0 ? (
        <p className="text-muted-foreground">
          No past tournaments yet.{" "}
          <Link href={`/tournament/${cfg.slug}`} className="text-primary underline">
            See this week&apos;s
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-6">
          {tournaments.map((t) => (
            <li key={t.id} id={t.id} className="card-ds scroll-mt-24 space-y-3 p-4">
              <div>
                <h2 className="text-lg font-semibold">{t.title}</h2>
                <p className="text-muted-foreground text-sm">
                  {MODE_LABEL[t.mode]} · week of {formatDateIST(t.weekOf)} · prize pool{" "}
                  {formatINR(t.prizePoolPaise)}
                </p>
              </div>
              {t.winners ? (
                <WinnersList winners={t.winners as unknown as PublishedWinner[]} />
              ) : (
                <p className="text-muted-foreground text-sm">Winners not published.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
