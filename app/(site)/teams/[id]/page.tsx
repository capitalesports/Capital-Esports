import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UsersIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { PlayerAvatar } from "@/components/common/player-avatar";
import { GameBadge } from "@/components/game/game-badge";
import { getPublicTeam } from "@/server/queries/teams";
import { GAME_CONFIG } from "@/lib/games";
import { isHeadToHead, MODE_LABEL } from "@/lib/match-modes";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/teams/[id]">): Promise<Metadata> {
  const team = await getPublicTeam((await params).id);
  if (!team) return { title: "Team not found" };
  return {
    title: team.name,
    description: `${team.name}: ${GAME_CONFIG[team.game].name} team roster and recent results.`,
  };
}

/** Public team page. Display names and avatars only: no phone numbers or game IDs. */
export default async function TeamPage({ params }: PageProps<"/teams/[id]">) {
  const team = await getPublicTeam((await params).id);
  if (!team) notFound();
  const captain = team.members.find((m) => m.id === team.captainId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={team.name}
        icon={<UsersIcon aria-hidden />}
        description={`${GAME_CONFIG[team.game].name} team${captain ? ` · Captain ${captain.displayName ?? "Player"}` : ""}`}
      >
        <GameBadge game={team.game} />
      </PageHeader>

      <section aria-labelledby="members-h" className="mb-8">
        <h2 id="members-h" className="mb-3 text-lg font-semibold">
          Members ({team.members.length})
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {team.members.map((m) => (
            <li key={m.id}>
              <Link
                href={`/players/${m.id}`}
                className="card-ds-interactive min-h-tap flex items-center gap-3 p-3"
              >
                <PlayerAvatar name={m.displayName ?? "Player"} src={m.avatarUrl} size={36} />
                <span className="truncate font-medium">{m.displayName ?? "Player"}</span>
                {m.id === team.captainId ? (
                  <span className="text-gold ml-auto text-xs font-semibold uppercase">Captain</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="results-h">
        <h2 id="results-h" className="mb-3 text-lg font-semibold">
          Recent results
        </h2>
        {team.results.length === 0 ? (
          <p className="text-muted-foreground text-sm">No approved results yet.</p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-xl border text-sm">
            {team.results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Link
                  href={`/scrims/${r.match.id}`}
                  className="min-h-tap inline-flex items-center font-medium hover:underline"
                >
                  {r.match.title}
                </Link>
                <span className="text-muted-foreground">
                  {r.match.tournamentId ? "Tournament" : "Scrim"} · {MODE_LABEL[r.match.mode]}
                </span>
                <span className="text-muted-foreground">{formatIST(r.match.startsAt)}</span>
                <span
                  className={cn(
                    "ml-auto",
                    r.won === true && "text-success",
                    r.won === false && "text-destructive",
                  )}
                >
                  {isHeadToHead(r.match.mode)
                    ? r.won
                      ? "Won"
                      : "Lost"
                    : `#${r.placement ?? "-"} · ${r.kills ?? 0} kills`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
