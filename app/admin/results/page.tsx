import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { DeleteMatchButton } from "@/components/admin/delete-match-button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listMatchesAwaitingResults } from "@/server/services/results";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Results" };

export default async function AdminResultsPage() {
  const user = await requireStaffPage("/admin/results");
  const matches = await listMatchesAwaitingResults(toActor(user));
  return (
    <>
      <PageHeader
        title="Results"
        description="Matches that are live or waiting for results. Completed matches can be reopened from their results page."
      />
      {matches.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="Matches appear here once they go live."
          action={{ href: "/admin/matches", label: "All matches" }}
        />
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.id} className="card-ds flex flex-wrap items-center gap-3 p-3">
              <GameBadge game={m.game} />
              <Link href={`/admin/results/${m.id}`} className="font-medium hover:underline">
                {m.title}
              </Link>
              <StatusPill status={m.status} />
              <span className="text-muted-foreground text-sm">{formatIST(m.startsAt)}</span>
              <span className="ml-auto text-sm">
                {m._count.results}/{m._count.registrations} submitted
              </span>
              {/* Admins can delete (DECISIONS M25); the server refuses paid or prize-locked matches. */}
              {user.role === "ADMIN" ? (
                <DeleteMatchButton
                  matchId={m.id}
                  title={m.title}
                  registrations={m._count.registrations}
                  played={m.status === "RESULTS_PENDING"}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
