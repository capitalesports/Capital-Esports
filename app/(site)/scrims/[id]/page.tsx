import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { artKey } from "@/lib/artwork";
import { ReportDialog } from "@/components/common/report-dialog";
import { ShareButton } from "@/components/common/share-button";
import { Markdown } from "@/components/content/markdown";
import { GameBadge } from "@/components/game/game-badge";
import { RegistrationPanel } from "@/components/match/registration-panel";
import { ResultSubmitForm } from "@/components/match/result-submit-form";
import { ResultsTable } from "@/components/match/results-table";
import { RoomPanel } from "@/components/match/room-panel";
import { StatusPill } from "@/components/match/status-pill";
import { getCurrentUser } from "@/server/auth/session";
import { getLobbyGroup, getPublicMatch, getRegisteredEntries } from "@/server/queries/matches";
import { buildPanelState, checkoutMode } from "@/server/queries/registration-panel";
import {
  getPublicResults,
  ownConfirmedRegistration,
  playedInMatch,
} from "@/server/queries/results";
import { isConfirmedPlayer } from "@/server/services/registration";
import { getContent } from "@/server/services/content";
import { GAME_CONFIG } from "@/lib/games";
import { isOpenEntry, lobbyNoun, lobbyWord } from "@/lib/lobbies";
import { MODE_LABEL, isHeadToHead, isTeamMode, playersPerSlot } from "@/lib/match-modes";
import { formatEntryFee, formatINR } from "@/lib/money";
import { isWithinDisputeWindow } from "@/lib/points";
import { canSeeRoomCredentials } from "@/lib/registration-rules";
import { formatIST } from "@/lib/time";

export async function generateMetadata({ params }: PageProps<"/scrims/[id]">): Promise<Metadata> {
  const match = await getPublicMatch((await params).id);
  if (!match) return { title: "Match not found" };
  return {
    title: match.title,
    description: `${GAME_CONFIG[match.game].name} ${MODE_LABEL[match.mode]} · ${formatIST(match.startsAt)} · ${
      isOpenEntry(match)
        ? `${match._count.registrations} joined`
        : `${match._count.registrations}/${match.maxSlots} slots`
    }`,
  };
}

export default async function MatchPage({ params }: PageProps<"/scrims/[id]">) {
  const { id } = await params;
  const match = await getPublicMatch(id);
  if (!match) notFound();
  const user = await getCurrentUser();
  const path = `/scrims/${match.id}`;
  const [panel, rules, confirmed, registered, group] = await Promise.all([
    buildPanelState(match, user, path),
    getContent(`rules.${match.game}`),
    user ? isConfirmedPlayer(match.id, user.id) : Promise.resolve(false),
    getRegisteredEntries(match.id),
    getLobbyGroup(match, user?.id ?? null),
  ]);
  const openEntry = isOpenEntry(match);
  const word = lobbyWord(match.mode);
  const unit = !isTeamMode(match.mode) ? "players" : match.mode === "SQUAD" ? "squads" : "teams";
  const br = !isHeadToHead(match.mode);
  const [ownReg, results, played] = await Promise.all([
    user && match.status === "RESULTS_PENDING"
      ? ownConfirmedRegistration(match.id, user.id)
      : Promise.resolve(null),
    match.status === "COMPLETED" ? getPublicResults(match.id, match.mode) : Promise.resolve([]),
    user && match.status === "COMPLETED"
      ? playedInMatch(match.id, user.id)
      : Promise.resolve(false),
  ]);
  const canDispute = played && isWithinDisputeWindow(match.resultsApprovedAt, new Date());
  const myResult = user ? results.find((r) => r.players.some((p) => p.id === user.id)) : undefined;
  const gameName = GAME_CONFIG[match.game].name;
  const shareText = myResult
    ? br
      ? myResult.placement === 1
        ? `Won today's ${gameName} scrim "${match.title}"!`
        : `Finished #${myResult.placement} in "${match.title}" (${gameName}).`
      : myResult.won
        ? `Won "${match.title}" (${gameName})!`
        : `Played "${match.title}" (${gameName}).`
    : `Results are in for "${match.title}" (${gameName}).`;
  const showRoom = canSeeRoomCredentials(match, confirmed);

  const facts: [string, React.ReactNode][] = [
    ["Starts", formatIST(match.startsAt)],
    ["Registration closes", formatIST(match.registrationClosesAt)],
    [
      "Mode",
      isTeamMode(match.mode)
        ? `${MODE_LABEL[match.mode]} · ${playersPerSlot(match.game, match.mode)} per team`
        : MODE_LABEL[match.mode],
    ],
    ["Scoring", br ? "Placement + kills" : "Win / loss"],
    [
      `Registered ${unit}`,
      openEntry
        ? `${match._count.registrations} · ${match.maxSlots} per ${word.toLowerCase()}`
        : `${match._count.registrations} / ${match.maxSlots}`,
    ],
    ["Entry fee", formatEntryFee(match.entryFeePaise)],
    ["Prize", match.prizePaise ? formatINR(match.prizePaise) : "—"],
  ];

  return (
    <div className="py-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-3 text-sm">
        <Link href={`/scrims?game=${GAME_CONFIG[match.game].slug}`} className="hover:underline">
          {GAME_CONFIG[match.game].name} scrims
        </Link>
      </nav>
      <div className="card-ds relative isolate overflow-hidden p-5 sm:p-8">
        <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-2/5">
          <Artwork
            name={`card-match-${artKey(match.game)}`}
            placeholderBorder={false}
            priority
            sizes="(min-width: 1024px) 520px, 40vw"
            className="object-right"
          />
          <span className="from-surface via-surface/30 absolute inset-0 bg-gradient-to-r to-transparent" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GameBadge game={match.game} />
          <StatusPill status={match.status} />
        </div>
        <h1 className="mt-2 text-3xl font-extrabold uppercase sm:text-5xl">{match.title}</h1>
      </div>
      {match.status === "CANCELLED" && match.cancelReason ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Cancelled: {match.cancelReason}. Entry fees are refunded automatically.
        </p>
      ) : null}

      {group ? (
        <section aria-labelledby="lobbies-heading" className="card-ds mt-4 space-y-3 p-4">
          <h2 id="lobbies-heading" className="text-lg font-semibold">
            {word === "Game" ? "Games" : "Lobbies"}
          </h2>
          <p className="text-muted-foreground text-sm">
            So many {unit} joined that registration was split into {group.lobbies.length}{" "}
            {lobbyNoun(match.mode, group.lobbies.length)}. Each {word.toLowerCase()} has its own room, results and prize.
          </p>
          {group.myLobbyId && group.myLobbyId !== match.id ? (
            <p className="border-gold/60 bg-gold/10 rounded-lg border p-3 text-sm" role="status">
              You play in{" "}
              <Link href={`/scrims/${group.myLobbyId}`} className="text-gold font-semibold underline">
                {word}{" "}
                {group.lobbies.find((l) => l.id === group.myLobbyId)?.lobbyNumber ?? ""}
              </Link>
              : your room ID and password appear there.
            </p>
          ) : null}
          {group.iAmUnplaced ? (
            <p className="border-border rounded-lg border p-3 text-sm" role="status">
              You have no opponent yet (odd number of entries). An admin will place you; if not,
              your entry is refunded when the games start.
            </p>
          ) : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.lobbies.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/scrims/${l.id}`}
                  aria-current={l.id === match.id ? "page" : undefined}
                  className={`card-ds-interactive min-h-tap flex items-center justify-between gap-2 px-3 py-2 ${l.id === match.id ? "border-gold" : ""}`}
                >
                  <span className="font-medium">
                    {word} {l.lobbyNumber}
                    {l.id === group.myLobbyId ? (
                      <span className="text-gold ml-2 text-xs">Your {word.toLowerCase()}</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {l._count.registrations} {unit}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <dl className="card-ds grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground text-xs">{k}</dt>
                <dd className="font-heading text-lg font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          {match.description ? <p className="text-muted-foreground">{match.description}</p> : null}
          {registered.entries.length || registered.waitlisted ? (
            <section aria-labelledby="entries-heading" className="space-y-2">
              <h2 id="entries-heading" className="text-lg font-semibold">
                Registered {unit}
              </h2>
              {registered.entries.length ? (
                <ol className="card-ds grid gap-x-4 p-2 sm:grid-cols-2">
                  {registered.entries.map((e, i) => (
                    <li key={e.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                        {i + 1}
                      </span>
                      <Link
                        href={e.href}
                        className="min-h-tap inline-flex min-w-0 items-center truncate hover:underline"
                      >
                        {e.name}
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : null}
              {registered.waitlisted ? (
                <p className="text-muted-foreground text-sm">
                  {registered.waitlisted} on the waitlist.
                </p>
              ) : null}
            </section>
          ) : null}
          {match.streamUrl ? (
            <a
              href={match.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-tap text-primary inline-flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <ExternalLinkIcon aria-hidden className="size-4" /> Watch the stream on YouTube
            </a>
          ) : null}
          {match.status === "COMPLETED" ? (
            <section aria-labelledby="results-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="results-heading" className="text-lg font-semibold">
                  Results
                </h2>
                <div className="flex flex-wrap gap-2">
                  <ShareButton text={shareText} url={path} label="Share result" />
                  {user ? (
                    <ReportDialog type={canDispute ? "DISPUTE" : "RESULT"} matchId={match.id} />
                  ) : null}
                </div>
              </div>
              <ResultsTable rows={results} battleRoyale={br} />
            </section>
          ) : null}
          {ownReg ? (
            <ResultSubmitForm
              matchId={match.id}
              battleRoyale={br}
              mode={match.mode}
              existing={
                ownReg.results[0]
                  ? {
                      placement: ownReg.results[0].placement,
                      kills: ownReg.results[0].kills,
                      won: ownReg.results[0].won,
                      roundDiff: ownReg.results[0].roundDiff,
                      hasScreenshot: !!ownReg.results[0].screenshotUrl,
                    }
                  : null
              }
            />
          ) : null}
          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="mb-2 text-lg font-semibold">
              Rules
            </h2>
            {rules ? (
              <Markdown className="card-ds max-h-80 overflow-y-auto p-4">{rules}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">
                Standard {GAME_CONFIG[match.game].name} rules apply.
              </p>
            )}
            <Link
              href="/rules"
              className="min-h-tap text-primary mt-2 inline-flex items-center text-sm hover:underline"
            >
              Full rules, scoring and no-show policy
            </Link>
          </section>
        </div>
        <aside className="space-y-4">
          <section
            aria-labelledby="register-heading"
            className="card-ds border-gold/60 space-y-3 p-4"
          >
            <h2 id="register-heading" className="font-semibold">
              Registration
            </h2>
            <RegistrationPanel
              matchId={match.id}
              state={panel}
              profileHref={`/profile?returnTo=${encodeURIComponent(path)}`}
              checkoutMode={checkoutMode()}
              entryFeePaise={match.entryFeePaise}
            />
          </section>
          {showRoom ? <RoomPanel matchId={match.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
