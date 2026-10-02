import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatchForm } from "@/components/admin/match-form";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { paymentsEnabled } from "@/server/env";
import { getMatchForAdmin, listTournamentOptions } from "@/server/queries/admin-matches";
import { isEditable } from "@/lib/match-state";
import { paiseToRupeesInput } from "@/lib/money";
import { utcToIstInput } from "@/lib/time";

export const metadata: Metadata = { title: "Edit match" };

export default async function EditMatchPage({ params }: PageProps<"/admin/matches/[id]/edit">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/matches/${id}/edit`);
  const match = await getMatchForAdmin(toActor(user), id).catch(() => null);
  if (!match) notFound();
  const tournaments = await listTournamentOptions(match.tournamentId);
  const locked = match.registrations.some((r) => r.status !== "CANCELLED");
  const closeOffset = Math.round(
    (match.startsAt.getTime() - match.registrationClosesAt.getTime()) / 60_000,
  );

  return (
    <>
      <PageHeader title="Edit match" description={match.title} />
      {isEditable(match.status) ? (
        <MatchForm
          matchId={match.id}
          tournaments={tournaments}
          paymentsEnabled={paymentsEnabled()}
          lockGameAndMode={locked}
          initial={{
            game: match.game,
            kind: match.kind,
            mode: match.mode,
            title: match.title,
            description: match.description ?? "",
            startsAt: utcToIstInput(match.startsAt),
            registrationOpensAt: match.registrationOpensAt
              ? utcToIstInput(match.registrationOpensAt)
              : "",
            closeOffsetMinutes: String(closeOffset),
            minSlots: String(match.minSlots),
            entryFee: paiseToRupeesInput(match.entryFeePaise),
            prize: paiseToRupeesInput(match.prizePaise),
            streamUrl: match.streamUrl ?? "",
            tournamentId: match.tournamentId ?? "",
          }}
        />
      ) : (
        <p className="text-muted-foreground">
          This match has started or ended and can no longer be edited.
        </p>
      )}
    </>
  );
}
