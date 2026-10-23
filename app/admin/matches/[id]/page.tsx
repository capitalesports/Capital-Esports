import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import {
  CancelControls,
  CloneControls,
  RegistrationActions,
  RoomCredentialsForm,
  StatusControls,
} from "@/components/admin/match-controls";
import { DeleteMatchButton } from "@/components/admin/delete-match-button";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentQrBox } from "@/components/admin/payment-qr-box";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getMatchForAdmin } from "@/server/queries/admin-matches";
import { getLobbyGroup } from "@/server/queries/matches";
import { PickWinnerButtons } from "@/components/admin/pick-winner";
import { isHeadToHead } from "@/lib/match-modes";
import { ACTIVE_REGISTRATION, listMatchRegistrations } from "@/server/services/admin-registrations";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { RosterPlayerEdit } from "@/components/admin/roster-player-edit";
import { lobbyNoun, lobbyWord } from "@/lib/lobbies";
import { MODE_LABEL } from "@/lib/match-modes";
import { playerIdLabel } from "@/lib/player-label";
import { isCloneable, isEditable } from "@/lib/match-state";
import { formatEntryFee, formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Match" };

type RosterRow = Awaited<ReturnType<typeof listMatchRegistrations>>["rows"][number]["roster"][number];

function RosterPlayer({
  p,
  game,
  lower,
}: {
  p: RosterRow;
  game: Game;
  lower: (s: string) => string;
}) {
  return (
    <span>
      {p.igl ? <span className="text-gold mr-1 font-semibold">IGL</span> : null}
      {playerIdLabel(game, p.gameId, p.ign)}
      {/* The account name, when it isn't the in-game name already shown. */}
      {p.name !== p.ign ? <span className="text-muted-foreground"> · {p.name}</span> : null}
      {p.status !== "CONFIRMED" ? (
        <span className="text-muted-foreground"> · {lower(p.status)}</span>
      ) : null}
    </span>
  );
}

export default async function AdminMatchPage({ params }: PageProps<"/admin/matches/[id]">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/matches/${id}`);
  const match = await getMatchForAdmin(toActor(user), id).catch(() => null);
  if (!match) notFound();
  const [regs, group] = await Promise.all([
    listMatchRegistrations(toActor(user), id),
    getLobbyGroup(match, null),
  ]);
  const word = lobbyWord(match.mode);
  const unplaced =
    group && match.parentMatchId === null
      ? match.registrations.filter((r) => r.status === "WAITLISTED").length
      : 0;
  const confirmed = match.registrations.filter((r) => r.status === "CONFIRMED").length;
  const winnerEntries = match.registrations
    .filter((r) => r.status === "CONFIRMED")
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      registrationId: r.id,
      name: r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player",
    }));
  const editable = isEditable(match.status);
  const canPromote = match.status === "REGISTRATION_OPEN" || match.status === "REGISTRATION_CLOSED";
  const lower = (s: string) => s.replace(/_/g, " ").toLowerCase();
  // Same rule as assertCanManageMatch: tournament matches are admin-only.
  const canEditRoster =
    editable && (user.role === "ADMIN" || (!match.isEntryList && !match.tournamentId));

  const facts: [string, React.ReactNode][] = [
    ["Mode", `${match.kind === "TOURNAMENT" ? "Tournament · " : ""}${MODE_LABEL[match.mode]}`],
    ["Starts", formatIST(match.startsAt)],
    [
      "Registration opens",
      match.registrationOpensAt ? formatIST(match.registrationOpensAt) : "Manually",
    ],
    ["Registration closes", formatIST(match.registrationClosesAt)],
    ["Slots", `${confirmed}/${match.maxSlots} confirmed`],
    ["Minimum", match.minSlots ? `${match.minSlots} confirmed or cancelled` : "None"],
    ["Entry fee", formatEntryFee(match.entryFeePaise)],
    ["Prize", formatINR(match.prizePaise)],
    [
      "Stream",
      match.streamUrl ? (
        <a href={match.streamUrl} className="underline" target="_blank" rel="noreferrer">
          Link
        </a>
      ) : (
        "—"
      ),
    ],
    ["Tournament", match.tournament?.title ?? "—"],
    [
      "Room credentials",
      match.roomId
        ? `Sent: ${match.roomId}${match.roomPassword ? ` / ${match.roomPassword}` : ""}`
        : "Not set",
    ],
  ];

  return (
    <>
      <PageHeader
        title={match.title}
        description={
          <span className="inline-flex items-center gap-2">
            <GameBadge game={match.game} /> <StatusPill status={match.status} />
          </span>
        }
      >
        {editable ? (
          <Button asChild variant="outline">
            <Link href={`/admin/matches/${match.id}/edit`}>Edit</Link>
          </Button>
        ) : null}
        {match.status === "RESULTS_PENDING" || match.status === "COMPLETED" ? (
          <Button asChild variant="outline">
            <Link href={`/admin/results/${match.id}`}>Results</Link>
          </Button>
        ) : null}
        {user.role === "ADMIN" && !match.isEntryList && match.bracketRound === null ? (
          <DeleteMatchButton
            matchId={match.id}
            title={match.title}
            registrations={regs.rows.length}
            played={match.status === "RESULTS_PENDING" || match.status === "COMPLETED"}
            redirectTo="/admin/matches"
          />
        ) : null}
      </PageHeader>

      {match.status === "CANCELLED" && match.cancelReason ? (
        <p className="bg-muted mb-4 rounded-lg p-3 text-sm">Cancelled: {match.cancelReason}</p>
      ) : null}

      {user.role === "ADMIN" &&
      !match.isEntryList &&
      !match.parentMatchId &&
      match.bracketRound === null &&
      !match.tournamentId ? (
        <div className="mb-4">
          <PaymentQrBox
            matchId={match.id}
            entryFeePaise={match.entryFeePaise}
            qrUrl={match.paymentQrUrl}
          />
        </div>
      ) : null}

      {group ? (
        <section
          aria-label={`Split ${lobbyNoun(match.mode, 2)}`}
          className="card-ds mb-4 space-y-3 p-4"
        >
          <h2 className="font-semibold">
            Split into {group.lobbies.length} {lobbyNoun(match.mode, group.lobbies.length)}
          </h2>
          <p className="text-muted-foreground text-sm">
            Each {word.toLowerCase()} is its own match: set its room ID and password, and approve
            its results separately. Prizes are per {word.toLowerCase()}.
          </p>
          <ul className="flex flex-wrap gap-2">
            {group.lobbies.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/admin/matches/${l.id}`}
                  aria-current={l.id === match.id ? "page" : undefined}
                  className={`card-ds-interactive min-h-tap inline-flex items-center gap-2 px-3 text-sm ${l.id === match.id ? "border-gold" : ""}`}
                >
                  {word} {l.lobbyNumber} · {l._count.registrations}
                  <StatusPill status={l.status} />
                </Link>
              </li>
            ))}
          </ul>
          {unplaced ? (
            <p
              className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm"
              role="status"
            >
              {unplaced} unmatched {unplaced === 1 ? "entry has" : "entries have"} no opponent (odd
              number of entries). Remove {unplaced === 1 ? "it" : "them"} below to refund now, or
              promote one if a {word.toLowerCase()} loses a side. Anything still unmatched is
              refunded automatically when this {word.toLowerCase()} goes live.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="card-ds grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-4">
          {match.tournament &&
          match.bracketRound !== null &&
          isHeadToHead(match.mode) &&
          ["REGISTRATION_CLOSED", "LIVE", "RESULTS_PENDING"].includes(match.status) &&
          winnerEntries.length === 2 ? (
            <section aria-labelledby="winner-h" className="card-ds space-y-3 p-4">
              <h2 id="winner-h" className="font-semibold">
                Pick the winner
              </h2>
              <p className="text-muted-foreground text-sm">
                After the game: the winner moves to the next round of the bracket, and this game&apos;s
                room details are removed from both teams.
              </p>
              <PickWinnerButtons
                tournamentId={match.tournament.id}
                matchId={match.id}
                entries={winnerEntries}
              />
            </section>
          ) : null}
          <StatusControls matchId={match.id} status={match.status} />
          <RoomCredentialsForm
            matchId={match.id}
            game={match.game}
            status={match.status}
            current={{ roomId: match.roomId, roomPassword: match.roomPassword }}
          />
          {isCloneable(match) ? <CloneControls matchId={match.id} /> : null}
          <CancelControls matchId={match.id} status={match.status} />
        </div>
      </div>

      <h2 className="mt-8 mb-2 text-lg font-semibold">
        Registrations ({regs.rows.length})
        {editable ? (
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {regs.freeSlots} free slot{regs.freeSlots === 1 ? "" : "s"}
          </span>
        ) : null}
      </h2>
      {regs.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No registrations yet.</p>
      ) : (
        <div className="card-ds overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Player / team</TableHead>
                <TableHead>Roster ({GAME_CONFIG[match.game].name} ID)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regs.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.position}</TableCell>
                  <TableCell>
                    {r.teamId ? (
                      <>
                        <Link href={`/admin/teams/${r.teamId}`} className="hover:underline">
                          {r.name}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          captain {r.captain.name}
                        </span>
                      </>
                    ) : (
                      r.name
                    )}
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-1 text-xs">
                      {r.roster.map((p, i) => (
                        <li key={`${p.userId ?? p.gameId ?? "p"}-${i}`}>
                          {p.memberId && canEditRoster && ACTIVE_REGISTRATION.includes(r.status) ? (
                            <RosterPlayerEdit
                              matchId={match.id}
                              memberId={p.memberId}
                              game={match.game}
                              gameId={p.gameId}
                              ign={p.ign}
                            >
                              <RosterPlayer p={p} game={match.game} lower={lower} />
                            </RosterPlayerEdit>
                          ) : (
                            <RosterPlayer p={p} game={match.game} lower={lower} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>{lower(r.status)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.payment
                      ? `${lower(r.payment.status)} · ${formatINR(r.payment.amountPaise)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatIST(r.createdAt)}</TableCell>
                  <TableCell>
                    <RegistrationActions
                      matchId={match.id}
                      registrationId={r.id}
                      name={r.name}
                      canRemove={editable && ACTIVE_REGISTRATION.includes(r.status)}
                      canPromote={canPromote && regs.freeSlots > 0 && r.status === "WAITLISTED"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
