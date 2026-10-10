import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { TrophyIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { EmptyState } from "@/components/common/empty-state";
import { Markdown } from "@/components/content/markdown";
import { GameBadge } from "@/components/game/game-badge";
import { RegistrationPanel } from "@/components/match/registration-panel";
import {
  BracketView,
  LobbyList,
  LobbyStandingsTable,
  StreamEmbed,
} from "@/components/tournament/tournament-views";
import { TournamentModeSwitch } from "@/components/tournament/mode-switch";
import { TournamentPartners } from "@/components/tournament/tournament-partners";
import { WinnersList } from "@/components/tournament/winners-list";
import { getCurrentUser } from "@/server/auth/session";
import { getPublicMatch } from "@/server/queries/matches";
import { buildPanelState, checkoutMode } from "@/server/queries/registration-panel";
import { getActiveSponsors } from "@/server/services/content";
import { pointsConfigFor } from "@/server/services/leaderboard";
import {
  bracketRounds,
  bracketState,
  getCurrentTournaments,
  getTournamentLobbies,
  getTournamentMatches,
  lobbyStandingsFor,
} from "@/server/services/tournament-queries";
import { db } from "@/server/db";
import { artKey } from "@/lib/artwork";
import { gameFromSlug, GAME_CONFIG } from "@/lib/games";
import { sortByModeOrder, tournamentFormatLabel } from "@/lib/home";
import { formatEntryFee, formatINR } from "@/lib/money";
import { slotUnit } from "@/lib/match-modes";
import { requireGameSlug } from "@/lib/params";
import { formatDateIST, formatIST } from "@/lib/time";
import { entryCountLabel, pickByMode } from "@/lib/tournament";
import type { PublishedWinner } from "@/server/services/tournaments";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/tournament/[game]">): Promise<Metadata> {
  const game = gameFromSlug((await params).game);
  if (!game) return { title: "Tournament" };
  const t = pickByMode(
    sortByModeOrder(game, await getCurrentTournaments(game)),
    (await searchParams).mode,
  );
  return {
    title: t ? t.title : `${GAME_CONFIG[game].name} tournament`,
    description: t
      ? `${GAME_CONFIG[game].name} weekly tournament · prize pool ${formatINR(t.prizePoolPaise)} · ${formatIST(t.startsAt)}`
      : `Weekly ${GAME_CONFIG[game].name} tournament: format, prize pool, rules and standings.`,
  };
}

export default async function GameTournamentPage({
  params,
  searchParams,
}: PageProps<"/tournament/[game]">) {
  const game = requireGameSlug((await params).game);
  const cfg = GAME_CONFIG[game];
  const current = sortByModeOrder(game, await getCurrentTournaments(game));
  const t = pickByMode(current, (await searchParams).mode);

  if (!t) {
    return (
      <div className="py-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">{cfg.name} tournament</h1>
        <EmptyState
          title="No tournament scheduled this week"
          art="empty-no-matches"
          description="Weekly tournaments are announced on our WhatsApp channel and Discord. Warm up in the daily scrims meanwhile."
          action={{ href: `/scrims?game=${cfg.slug}`, label: `${cfg.name} scrims` }}
        />
        <Link
          href={`/tournament/${cfg.slug}/past`}
          className="min-h-tap text-gold hover:text-gold-hover mt-4 inline-flex items-center"
        >
          Past tournaments
        </Link>
      </div>
    );
  }

  const basePath = `/tournament/${cfg.slug}`;
  const path = t === current[0] ? basePath : `${basePath}?mode=${t.mode}`;
  const [entry, matches, user, config, sponsors] = await Promise.all([
    t.entryMatchId ? getPublicMatch(t.entryMatchId) : null,
    getTournamentMatches(t.id),
    getCurrentUser(),
    pointsConfigFor(db, game),
    getActiveSponsors(),
  ]);
  const panel =
    entry && entry.status === "REGISTRATION_OPEN" ? await buildPanelState(entry, user, path) : null;
  const standings = t.format === "LOBBY_POINTS" ? await lobbyStandingsFor(db, t.id) : [];
  // The bracket is drawn when registration closes; until then only the sign-up count shows.
  // Lobby tournaments: who plays in which lobby, once registration has closed.
  const lobbyInfo =
    t.format === "LOBBY_POINTS" && entry?.status === "REGISTRATION_CLOSED"
      ? await getTournamentLobbies(t.id, user?.id ?? null)
      : null;
  const bracket =
    t.format === "BRACKET" && t.entryMatchId && matches.length
      ? await bracketState(db, t.entryMatchId, t.id)
      : null;
  const winners = (t.winners as PublishedWinner[] | null) ?? null;

  return (
    <div className="py-6">
      <TournamentModeSwitch
        game={game}
        basePath={basePath}
        modes={current.map((c) => c.mode)}
        active={t.mode}
      />
      <section
        aria-labelledby="t-title"
        className={`card-ds relative isolate overflow-hidden p-5 sm:p-6 ${cfg.accent.borderSoft}`}
      >
        <div className="absolute inset-y-0 right-0 -z-10 w-2/5">
          <Artwork
            name={`card-tournament-${artKey(game)}`}
            placeholderBorder={false}
            priority
            sizes="(min-width: 1024px) 520px, 40vw"
            className="object-right"
          />
          <span
            aria-hidden
            className="from-surface via-surface/30 absolute inset-0 bg-gradient-to-r to-transparent"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrophyIcon aria-hidden className={`size-6 ${cfg.accent.text}`} />
          <GameBadge game={game} />
          <span className="text-muted-foreground text-sm">Week of {formatDateIST(t.weekOf)}</span>
        </div>
        <h1 id="t-title" className="mt-2 text-3xl font-extrabold uppercase sm:text-5xl">
          {t.title}
        </h1>
        <dl className="mt-5 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="flex flex-col-reverse">
            <dt className="text-muted-foreground text-xs">Prize Pool</dt>
            <dd className="font-heading text-gold text-3xl leading-none font-extrabold">
              {formatINR(t.prizePoolPaise)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Entry Fee</dt>
            <dd className="font-heading text-lg">{formatEntryFee(entry?.entryFeePaise ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Format</dt>
            <dd className="font-heading text-lg">
              {t.format === "BRACKET"
                ? `${tournamentFormatLabel(game, t.mode)} · single elimination`
                : `Lobby points · ${tournamentFormatLabel(game, t.mode)}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Starts</dt>
            <dd className="font-heading text-lg">{formatIST(t.startsAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{entryCountLabel(t.mode)}</dt>
            <dd className="font-heading text-lg">{entry?._count.registrations ?? 0}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          {winners?.length ? (
            <section aria-labelledby="winners-h">
              <h2 id="winners-h" className="mb-3 text-xl font-bold">
                Winners
              </h2>
              <WinnersList winners={winners} />
            </section>
          ) : null}
          <StreamEmbed url={t.streamUrl} title={t.title} />
          {lobbyInfo?.lobbies.length ? (
            <section aria-labelledby="lobbies-h" className="space-y-3">
              <h2 id="lobbies-h" className="text-xl font-bold">
                Lobbies
              </h2>
              <LobbyList
                lobbies={lobbyInfo.lobbies}
                mine={lobbyInfo.mine}
                unit={slotUnit(t.mode)}
              />
            </section>
          ) : null}
          <section aria-labelledby="bracket-h" className="space-y-3">
            <h2 id="bracket-h" className="text-xl font-bold">
              {t.format === "BRACKET" ? "Bracket" : "Standings"}
            </h2>
            {t.format === "BRACKET" ? (
              bracket ? (
                <BracketView rounds={bracketRounds(bracket, matches)} linkBase="/scrims" />
              ) : (
                <p className="text-muted-foreground text-sm">
                  The bracket is drawn when sign-ups close.
                </p>
              )
            ) : (
              <>
                <LobbyStandingsTable standings={standings} />
                <p className="text-muted-foreground text-xs">
                  Tournament points = (placement + kills) × {config.tournamentMultiplier}, summed
                  over every match.
                </p>
              </>
            )}
          </section>
          <section aria-labelledby="rules-h" className="space-y-2">
            <h2 id="rules-h" className="text-xl font-bold">
              Rules
            </h2>
            {t.rulesMarkdown ? (
              <Markdown className="card-ds p-4">{t.rulesMarkdown}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">Standard {cfg.name} rules apply.</p>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section
            aria-labelledby="register-heading"
            className="card-ds border-gold/60 space-y-3 p-4"
          >
            <h2 id="register-heading" className="text-xl font-bold">
              Registration
            </h2>
            {panel && entry ? (
              <RegistrationPanel
                matchId={entry.id}
                state={panel}
                profileHref={`/profile?returnTo=${encodeURIComponent(path)}`}
                checkoutMode={entry.paymentQrUrl ? "manual" : checkoutMode()}
                entryFeePaise={entry.entryFeePaise}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {entry?.status === "UPCOMING" ? "Sign-ups open soon." : "Sign-ups are closed."}
              </p>
            )}
          </section>
          <TournamentPartners
            partners={sponsors.map((s) => ({
              id: s.id,
              name: s.name,
              logoUrl: s.logoUrl,
              url: s.url,
            }))}
          />
          <Link
            href={`/tournament/${cfg.slug}/past`}
            className="min-h-tap text-gold hover:text-gold-hover inline-flex items-center"
          >
            Past {cfg.name} tournaments
          </Link>
        </aside>
      </div>
    </div>
  );
}
