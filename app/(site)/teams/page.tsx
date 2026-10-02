import type { Metadata } from "next";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  CreateTeamForm,
  JoinTeamForm,
  TeamCard,
  TeamInvite,
  type TeamView,
} from "@/components/teams/team-components";
import { requirePageUser } from "@/server/auth/guards";
import { getMyTeams } from "@/server/services/teams";
import { GAMES } from "@/lib/games";
import { isTeamMode, MATCH_MODES, MODE_LABEL } from "@/lib/match-modes";
import { isGameProfileComplete } from "@/lib/profile";
import { TEAM_CODE_LENGTH } from "@/lib/team-code";

export const metadata: Metadata = { title: "Teams", robots: { index: false } };

/** "Squad, 2v2, 4v4 and 5v5" */
const TEAM_MODES = (() => {
  const labels = MATCH_MODES.filter(isTeamMode).map((m) => MODE_LABEL[m]);
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
})();

export default async function TeamsPage() {
  const user = await requirePageUser("/teams");
  const { teams, invites } = await getMyTeams(user.id);
  const linkedGames = user.gameProfiles.map((p) => p.game);
  const readyGames = user.gameProfiles.filter(isGameProfileComplete).map((p) => p.game);
  const availableGames = GAMES.filter((g) => !teams.some((t) => t.game === g));

  const views: TeamView[] = teams.map((t) => ({
    id: t.id,
    game: t.game,
    name: t.name,
    joinCode: t.joinCode,
    captainId: t.captainId,
    members: t.members.map((m) => {
      const p = m.user.gameProfiles.find((g) => g.game === t.game);
      return {
        userId: m.user.id,
        name: m.user.displayName ?? "Player",
        gameLabel: p ? (t.game === "VALORANT" ? (p.ign ?? p.gameId) : p.gameId) : "",
        status: m.status,
      };
    }),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Teams"
        description={`One team per game. The captain registers the team for ${TEAM_MODES} matches.`}
      />
      {invites.length ? (
        <section aria-labelledby="invites-h" className="mb-8">
          <h2 id="invites-h" className="mb-2 text-lg font-semibold">
            Invites
          </h2>
          <ul className="space-y-2">
            {invites.map((t) => (
              <TeamInvite
                key={t.id}
                teamId={t.id}
                name={t.name}
                game={t.game}
                captain={t.captain.displayName ?? "Captain"}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="my-teams-h" className="mb-8 space-y-4">
        <h2 id="my-teams-h" className="text-lg font-semibold">
          My teams
        </h2>
        {views.length === 0 ? (
          <EmptyState
            art="empty-no-team"
            title="You are not in a team yet"
            description="Create a team below, or join one with the code its captain shares."
          />
        ) : null}
        {views.map((t) => (
          <TeamCard key={t.id} team={t} meId={user.id} />
        ))}
      </section>
      {/* Players already in a team don't see "Join a team" (DECISIONS M19). */}
      {views.length === 0 ? (
        <section aria-labelledby="join-h" className="mb-8 space-y-3">
          <h2 id="join-h" className="text-lg font-semibold">
            Join a team
          </h2>
          <p className="text-muted-foreground text-sm">
            Enter the {TEAM_CODE_LENGTH}-letter code shown on your team&apos;s card.
          </p>
          <JoinTeamForm readyGames={readyGames} />
        </section>
      ) : null}
      <section aria-labelledby="create-h" className="space-y-3">
        <h2 id="create-h" className="text-lg font-semibold">
          Create a team
        </h2>
        <CreateTeamForm availableGames={availableGames} linkedGames={linkedGames} />
      </section>
    </div>
  );
}
