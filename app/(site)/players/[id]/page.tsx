import type { Metadata } from "next";
import Image from "next/image";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import { ReportDialog } from "@/components/common/report-dialog";
import { GameBadge } from "@/components/game/game-badge";
import { MatchHistoryList } from "@/components/profile/match-history-list";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getMatchHistory } from "@/server/queries/dashboard";
import { isPlausibleId } from "@/server/queries/teams";
import { playerStanding } from "@/server/services/leaderboard";
import { gameFromSlug, GAME_CONFIG, GAMES } from "@/lib/games";

async function loadPlayer(id: string) {
  if (!isPlausibleId(id)) return null;
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
      gameProfiles: { select: { game: true, ign: true, gameId: true } },
      teamMemberships: {
        where: { status: "CONFIRMED" },
        select: { team: { select: { id: true, name: true, game: true } } },
      },
    },
  });
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/players/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = await loadPlayer(id);
  if (!p) return { title: "Player" };
  const wanted = gameFromSlug(
    typeof (await searchParams).game === "string" ? ((await searchParams).game as string) : null,
  );
  const game = wanted ?? p.gameProfiles[0]?.game ?? null;
  const images = game
    ? [{ url: `/leaderboard/${GAME_CONFIG[game].slug}/card/${p.id}`, width: 1200, height: 630 }]
    : undefined;
  return {
    title: p.displayName ?? "Player",
    description: `${p.displayName ?? "Player"}'s season rank and points.`,
    openGraph: { images },
    twitter: { card: "summary_large_image", images: images?.map((i) => i.url) },
  };
}

/** Public player profile. Shows in-game names, never phone numbers or dates of birth. */
export default async function PlayerPage({ params }: PageProps<"/players/[id]">) {
  const player = await loadPlayer((await params).id);
  if (!player) notFound();
  const [viewer, history, standings] = await Promise.all([
    getCurrentUser(),
    getMatchHistory(player.id, { take: 10, completedOnly: true }),
    Promise.all(
      GAMES.filter((g) => player.gameProfiles.some((p) => p.game === g)).map(async (g) => ({
        game: g,
        s: await playerStanding(player.id, g),
      })),
    ),
  ]);

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="flex items-center gap-4">
        <div className="bg-muted relative size-20 overflow-hidden rounded-full">
          {player.avatarUrl ? (
            <Image
              src={player.avatarUrl}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span
              className="text-muted-foreground flex size-full items-center justify-center text-2xl font-bold"
              aria-hidden
            >
              {(player.displayName ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{player.displayName ?? "Player"}</h1>
          <p className="text-muted-foreground text-sm">
            Playing since {player.createdAt.getFullYear()}
          </p>
        </div>
        {viewer && viewer.id !== player.id ? (
          <ReportDialog type="PLAYER" targetUserId={player.id} />
        ) : null}
      </div>

      <section aria-labelledby="games-h" className="mt-8 space-y-3">
        <h2 id="games-h" className="text-lg font-semibold">
          This season
        </h2>
        {standings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No games linked yet.</p>
        ) : null}
        {standings.map(({ game, s }) => {
          const profile = player.gameProfiles.find((p) => p.game === game)!;
          const team = player.teamMemberships.find((m) => m.team.game === game)?.team.name;
          return (
            <Link
              key={game}
              href={`/leaderboard/${GAME_CONFIG[game].slug}`}
              className="card-ds hover:bg-accent flex items-center gap-3 p-4"
            >
              <GameBadge game={game} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {game === "VALORANT" ? profile.ign : (profile.ign ?? profile.gameId)}
                </p>
                <p className="text-muted-foreground text-xs">{team ? `Team ${team}` : "No team"}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{s?.points ?? 0} pts</p>
                <p className="text-muted-foreground text-xs">
                  {s?.rank ? `Rank #${s.rank}` : "Unranked"}
                </p>
              </div>
            </Link>
          );
        })}
      </section>

      {player.teamMemberships.length ? (
        <section aria-labelledby="teams-h" className="mt-8 space-y-3">
          <h2 id="teams-h" className="text-lg font-semibold">
            Teams
          </h2>
          <ul className="flex flex-wrap gap-2">
            {player.teamMemberships.map(({ team }) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}`}
                  className="min-h-tap border-border hover:border-gold inline-flex items-center gap-2 rounded-lg border px-3"
                >
                  <GameBadge game={team.game} /> {team.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="history-h" className="mt-8 space-y-3">
        <h2 id="history-h" className="text-lg font-semibold">
          Recent matches
        </h2>
        <MatchHistoryList rows={history} empty="No completed matches yet." />
      </section>
    </div>
  );
}
