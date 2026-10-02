import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import {
  CancelTournamentForm,
  EditTournamentForm,
  GenerateBracketForm,
  LobbyMatchesForm,
  PublishWinnersForm,
} from "@/components/admin/tournament-forms";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import {
  BracketView,
  LobbyStandingsTable,
  TournamentSchedule,
} from "@/components/tournament/tournament-views";
import { requireStaffPage } from "@/server/auth/guards";
import { db } from "@/server/db";
import { paymentsEnabled } from "@/server/env";
import {
  bracketRounds,
  getTournamentMatches,
  lobbyStandingsFor,
} from "@/server/services/tournament-queries";
import { MODE_LABEL } from "@/lib/match-modes";
import { formatEntryFee, formatINR, paiseToRupeesInput } from "@/lib/money";
import { formatIST, utcToIstInput } from "@/lib/time";

export const metadata: Metadata = { title: "Tournament" };

export default async function AdminTournamentPage({
  params,
}: PageProps<"/admin/tournaments/[id]">) {
  const { id } = await params;
  await requireStaffPage(`/admin/tournaments/${id}`);
  const t = await db.tournament.findUnique({ where: { id } });
  if (!t) notFound();
  const [entry, matches] = await Promise.all([
    t.entryMatchId
      ? db.match.findUnique({
          where: { id: t.entryMatchId },
          include: {
            registrations: {
              where: { status: { not: "CANCELLED" } },
              orderBy: { position: "asc" },
              include: {
                team: { select: { name: true } },
                user: { select: { displayName: true } },
              },
            },
          },
        })
      : null,
    getTournamentMatches(t.id),
  ]);
  const standings = t.format === "LOBBY_POINTS" ? await lobbyStandingsFor(db, t.id) : [];
  const confirmed = entry?.registrations.filter((r) => r.status === "CONFIRMED").length ?? 0;
  const allDone =
    matches.length > 0 &&
    matches.every((m) => m.status === "COMPLETED" || m.status === "CANCELLED");
  const cancelled = !!t.cancelledAt;
  const locked = !!entry && !["UPCOMING", "REGISTRATION_OPEN"].includes(entry.status);
  const structureEditable = !cancelled && matches.length === 0 && !entry?.registrations.length;
  const hasResultsPending = matches.some((m) => m.status === "RESULTS_PENDING");

  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <GameBadge game={t.game} /> {MODE_LABEL[t.mode]} ·{" "}
            {t.format === "BRACKET" ? `${t.bracketSize}-entry bracket` : "Lobby points"} · starts{" "}
            {formatIST(t.startsAt)} · prize {formatINR(t.prizePoolPaise)} · entry{" "}
            {formatEntryFee(entry?.entryFeePaise ?? 0)}
          </span>
        }
      />
      {cancelled ? (
        <p role="status" className="bg-destructive/15 text-destructive mb-4 rounded-lg p-3 text-sm">
          Cancelled {formatIST(t.cancelledAt!)}
          {t.cancelReason ? `: ${t.cancelReason}` : ""}. Open matches were cancelled and refunded.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <EditTournamentForm
            t={{
              id: t.id,
              title: t.title,
              prizePool: paiseToRupeesInput(t.prizePoolPaise),
              rulesMarkdown: t.rulesMarkdown,
              streamUrl: t.streamUrl ?? "",
            }}
            structure={
              structureEditable
                ? {
                    game: t.game,
                    mode: t.mode,
                    startsAt: utcToIstInput(t.startsAt),
                    size: t.format === "BRACKET" ? String(t.bracketSize ?? 8) : "",
                    entryFee: paiseToRupeesInput(entry?.entryFeePaise ?? 0),
                  }
                : undefined
            }
            paymentsEnabled={paymentsEnabled()}
          />
          {cancelled ? null : t.format === "LOBBY_POINTS" ? (
            <LobbyMatchesForm
              tournamentId={t.id}
              defaultStart={utcToIstInput(t.startsAt)}
              locked={locked}
            />
          ) : matches.length === 0 ? (
            <GenerateBracketForm
              tournamentId={t.id}
              defaultStart={utcToIstInput(t.startsAt)}
              size={t.bracketSize ?? 8}
              confirmed={confirmed}
            />
          ) : null}
          {allDone && !cancelled ? (
            <PublishWinnersForm tournamentId={t.id} prizePool={t.prizePoolPaise} />
          ) : null}
          {t.winnersPublishedAt ? (
            <p className="text-success text-sm">
              Winners published {formatIST(t.winnersPublishedAt)}.
            </p>
          ) : null}
          {!cancelled && !t.winnersPublishedAt ? (
            hasResultsPending ? (
              <p className="text-muted-foreground text-sm">
                To cancel this tournament, first approve the results of matches waiting for
                results.
              </p>
            ) : (
              <CancelTournamentForm tournamentId={t.id} />
            )
          ) : null}
        </div>
        <section aria-label="Sign-ups" className="card-ds space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Sign-ups ({confirmed} confirmed)</h2>
            {entry ? <StatusPill status={entry.status} /> : null}
          </div>
          {entry ? (
            <Link
              href={`/admin/matches/${entry.id}`}
              className="text-primary text-sm hover:underline"
            >
              Manage sign-up list
            </Link>
          ) : null}
          <ol className="space-y-1 text-sm">
            {entry?.registrations.map((r) => (
              <li key={r.id}>
                {r.team?.name ?? r.user.displayName}{" "}
                <span className="text-muted-foreground">
                  ({r.status.toLowerCase().replace(/_/g, " ")})
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <section className="mt-8 space-y-3" aria-label="Matches">
        <h2 className="text-lg font-semibold">{t.format === "BRACKET" ? "Bracket" : "Matches"}</h2>
        {t.format === "BRACKET" && t.bracketSize && matches.length ? (
          <BracketView rounds={bracketRounds(t.bracketSize, matches)} linkBase="/admin/matches" />
        ) : (
          <TournamentSchedule matches={matches} linkBase="/admin/matches" />
        )}
      </section>
      {t.format === "LOBBY_POINTS" ? (
        <section className="mt-8 space-y-3" aria-label="Standings">
          <h2 className="text-lg font-semibold">Standings</h2>
          <LobbyStandingsTable standings={standings} />
        </section>
      ) : null}
    </>
  );
}
