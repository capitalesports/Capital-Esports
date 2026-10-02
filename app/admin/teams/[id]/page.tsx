import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamMemberActions } from "@/components/admin/team-member-actions";
import { PageHeader } from "@/components/common/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getTeamDetail } from "@/server/services/admin-teams";
import { GAME_CONFIG } from "@/lib/games";

export const metadata: Metadata = { title: "Team" };

export default async function AdminTeamPage({ params }: PageProps<"/admin/teams/[id]">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/teams/${id}`);
  const team = await getTeamDetail(toActor(user), id).catch(() => null);
  if (!team) notFound();

  return (
    <>
      <PageHeader
        title={team.name}
        description={`${GAME_CONFIG[team.game].name} · captain ${team.captain.displayName ?? "—"}`}
      />
      <div className="card-ds overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>{GAME_CONFIG[team.game].idLabel}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.members.map((m) => {
              const profile = m.user.gameProfiles.find((p) => p.game === team.game);
              return (
                <TableRow key={m.id}>
                  <TableCell>{m.user.displayName ?? "—"}</TableCell>
                  <TableCell>
                    {profile ? (team.game === "VALORANT" ? profile.ign : profile.gameId) : "—"}
                  </TableCell>
                  <TableCell>{m.status.toLowerCase()}</TableCell>
                  <TableCell>
                    <TeamMemberActions
                      teamId={team.id}
                      userId={m.user.id}
                      isCaptain={team.captainId === m.user.id}
                      confirmed={m.status === "CONFIRMED"}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
