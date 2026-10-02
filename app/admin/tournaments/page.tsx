import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { CreateTournamentForm } from "@/components/admin/tournament-forms";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { requireStaffPage } from "@/server/auth/guards";
import { db } from "@/server/db";
import { paymentsEnabled } from "@/server/env";
import { MODE_LABEL } from "@/lib/match-modes";
import { formatINR } from "@/lib/money";
import { formatDateIST, formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Tournaments" };

export default async function AdminTournamentsPage() {
  await requireStaffPage("/admin/tournaments");
  const tournaments = await db.tournament.findMany({ orderBy: { weekOf: "desc" }, take: 50 });
  return (
    <>
      <PageHeader
        title="Tournaments"
        description="One per game and mode per week. Solo, Duo and Squad use lobby points; 1v1, 2v2, 4v4 and 5v5 use a bracket."
      />
      <ul className="mb-10 space-y-2">
        {tournaments.map((t) => (
          <li key={t.id} className="card-ds flex flex-wrap items-center gap-3 p-3">
            <GameBadge game={t.game} />
            <Link href={`/admin/tournaments/${t.id}`} className="font-medium hover:underline">
              {t.title}
            </Link>
            <span className="text-muted-foreground text-sm">
              Week of {formatDateIST(t.weekOf)} · starts {formatIST(t.startsAt)} ·{" "}
              {formatINR(t.prizePoolPaise)}
            </span>
            <span className={`ml-auto text-xs ${t.cancelledAt ? "text-destructive" : ""}`}>
              {MODE_LABEL[t.mode]} · {t.format === "BRACKET" ? "Bracket" : "Lobby points"}
              {t.cancelledAt ? " · Cancelled" : t.winnersPublishedAt ? " · Winners published" : ""}
            </span>
          </li>
        ))}
        {tournaments.length === 0 ? (
          <li className="text-muted-foreground text-sm">No tournaments yet.</li>
        ) : null}
      </ul>
      <h2 className="mb-3 text-lg font-semibold">New tournament</h2>
      <CreateTournamentForm paymentsEnabled={paymentsEnabled()} />
    </>
  );
}
