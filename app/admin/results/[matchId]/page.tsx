import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import { ResultsEditor } from "@/components/admin/results-editor";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getResultsForModeration } from "@/server/services/results";
import { canReopenResults } from "@/lib/points";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Review results" };

export default async function AdminMatchResultsPage({
  params,
}: PageProps<"/admin/results/[matchId]">) {
  const { matchId } = await params;
  const user = await requireStaffPage(`/admin/results/${matchId}`);
  const data = await getResultsForModeration(toActor(user), matchId).catch(() => null);
  if (!data) notFound();
  const { match, entries } = data;
  if (user.role === "PLAYER") notFound();

  return (
    <>
      <PageHeader
        title={`Results: ${match.title}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <GameBadge game={match.game} /> <StatusPill status={match.status} />{" "}
            {formatIST(match.startsAt)}
            {match.kind === "TOURNAMENT" ? " · tournament points ×" : ""}
          </span>
        }
      >
        <Link
          href={`/admin/matches/${match.id}`}
          className="min-h-tap text-primary inline-flex items-center text-sm hover:underline"
        >
          Match details
        </Link>
      </PageHeader>
      {match.status !== "RESULTS_PENDING" && match.status !== "COMPLETED" ? (
        <p className="text-muted-foreground">
          Results open once the match moves to “Results pending”.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground">No confirmed entries in this match.</p>
      ) : (
        <ResultsEditor
          matchId={match.id}
          status={match.status}
          mode={match.mode}
          canReopen={
            canReopenResults(user.role, match.resultsApprovedAt, new Date()) &&
            (!match.tournament?.winnersPublishedAt || user.role === "ADMIN")
          }
          reopenBlockedReason={
            match.tournament?.winnersPublishedAt && user.role !== "ADMIN"
              ? "Winners of this tournament are already published. Only an admin can reopen (it clears the published winners)."
              : undefined
          }
          entries={entries.map((e) => ({
            registrationId: e.registrationId,
            name: e.name,
            status: e.status,
            screenshotUrl: e.result?.screenshotUrl ?? null,
            trackerUrl: e.result?.trackerUrl ?? null,
            submitted: !!e.result?.submittedById,
            placement: e.result?.placement ?? null,
            kills: e.result?.kills ?? null,
            won: e.result?.won ?? null,
            roundDiff: e.result?.roundDiff ?? null,
          }))}
        />
      )}
    </>
  );
}
