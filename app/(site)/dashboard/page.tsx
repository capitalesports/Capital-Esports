import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { RoomPanel } from "@/components/match/room-panel";
import { StatusPill } from "@/components/match/status-pill";
import { MatchHistoryList } from "@/components/profile/match-history-list";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { Button } from "@/components/ui/button";
import { vapidPublicKey } from "@/server/providers/notification-channels";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guards";
import { getMatchHistory, getMyWinnings, getResultsToSubmit } from "@/server/queries/dashboard";
import { getMyMatches } from "@/server/queries/matches";
import { myPointsByGame } from "@/server/queries/points";
import { getMyTeams } from "@/server/services/teams";
import { GAME_CONFIG } from "@/lib/games";
import { MODE_LABEL } from "@/lib/match-modes";
import { formatINR } from "@/lib/money";
import { isProfileComplete } from "@/lib/profile";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

const ENTRY_LABEL: Record<string, string> = {
  PENDING: "Waiting for teammates",
  PENDING_PAYMENT: "Payment pending",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  NO_SHOW: "No-show",
};

const PAYOUT_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  PROCESSING: "Processing",
  SUCCESS: "Paid",
  FAILED: "Failed",
  REVERSED: "Reversed",
};

export default async function DashboardPage() {
  const user = await requirePageUser("/dashboard");
  const [entries, points, { teams, invites }, toSubmit, winnings] = await Promise.all([
    getMyMatches(user.id),
    myPointsByGame(user.id),
    getMyTeams(user.id),
    getResultsToSubmit(user.id),
    getMyWinnings(user.id),
  ]);
  const history = await getMatchHistory(user.id, {
    excludeMatchIds: toSubmit.map((r) => r.match.id),
  });
  const upcoming = entries.filter((e) =>
    ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"].includes(e.match.status),
  );
  const optedIn = (
    await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { pushOptIn: true } })
  ).pushOptIn;
  const rosterInvites = upcoming.filter(
    (e) => e.userId !== user.id && e.members[0]?.status === "INVITED",
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome${user.displayName ? `, ${user.displayName}` : ""}.`}
      >
        <Button asChild variant="outline">
          <Link href="/profile">Profile</Link>
        </Button>
      </PageHeader>

      {!isProfileComplete(user) ? (
        <p className="border-warning/40 bg-warning/10 mb-6 rounded-lg border p-3 text-sm">
          Your profile is incomplete.{" "}
          <Link href="/profile" className="underline">
            Add your name, date of birth and a verified email
          </Link>{" "}
          to register.
        </p>
      ) : null}
      {user.strikes > 0 ? (
        <p className="bg-muted mb-6 rounded-lg p-3 text-sm">
          Strikes this season: <strong>{user.strikes}</strong> of 3.
          {user.registrationBlockedUntil && user.registrationBlockedUntil > new Date()
            ? ` Registration blocked until ${formatIST(user.registrationBlockedUntil)}.`
            : " Three strikes block registration for 7 days."}
        </p>
      ) : null}

      {entries.length ? (
        <div className="mb-8 space-y-3">
          <PushOptIn vapidPublicKey={vapidPublicKey()} optedIn={optedIn} />
          <InstallPrompt />
        </div>
      ) : null}

      {toSubmit.length || rosterInvites.length || invites.length ? (
        <section aria-labelledby="action-h" className="mb-8">
          <h2 id="action-h" className="mb-2 text-lg font-semibold">
            Action needed
          </h2>
          <ul className="space-y-2 text-sm">
            {toSubmit.map((r) => (
              <li
                key={r.id}
                className="card-ds flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <GameBadge game={r.match.game} />
                  <span className="font-medium">{r.match.title}</span>
                  <span className="text-muted-foreground">
                    {MODE_LABEL[r.match.mode]} · {formatIST(r.match.startsAt)}
                  </span>
                </span>
                <Button asChild>
                  <Link href={`/scrims/${r.match.id}`}>Submit result</Link>
                </Button>
              </li>
            ))}
            {rosterInvites.map((e) => (
              <li key={e.id}>
                <Link href={`/scrims/${e.match.id}`} className="text-primary underline">
                  Confirm your spot in {e.team?.name ?? "a team"} for {e.match.title}
                </Link>
              </li>
            ))}
            {invites.map((t) => (
              <li key={t.id}>
                <Link href="/teams" className="text-primary underline">
                  Team invite from {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="upcoming-h" className="mb-8">
        <h2 id="upcoming-h" className="mb-3 text-lg font-semibold">
          My upcoming matches
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            art="empty-no-matches"
            title="No upcoming matches"
            description="Register for a scrim or tournament to see it here."
            action={{ href: "/scrims", label: "Browse scrims" }}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {upcoming.map((e) => {
              // A tournament sign-up lives on the game's tournament page; matches on their own page.
              const signUp = e.match.isEntryList;
              const teamName = e.team?.name ?? e.teamName;
              return (
              <article key={e.id} className="card-ds space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <GameBadge game={e.match.game} />
                  {signUp ? (
                    <span className="text-gold text-xs font-semibold">Tournament</span>
                  ) : (
                    <StatusPill status={e.match.status} />
                  )}
                  <span className="text-muted-foreground text-xs">{ENTRY_LABEL[e.status]}</span>
                </div>
                <h3 className="font-semibold">
                  <Link
                    href={
                      signUp
                        ? `/tournament/${GAME_CONFIG[e.match.game].slug}`
                        : `/scrims/${e.match.id}`
                    }
                    className="hover:underline"
                  >
                    {signUp ? (e.match.tournament?.title ?? e.match.title) : e.match.title}
                  </Link>
                </h3>
                <p className="text-muted-foreground text-sm">
                  {formatIST(e.match.startsAt)} · {MODE_LABEL[e.match.mode]}
                  {teamName ? ` · ${teamName}` : ""}
                </p>
                {!signUp &&
                e.status === "CONFIRMED" &&
                (e.userId === user.id || e.members[0]?.status === "CONFIRMED") ? (
                  <RoomPanel matchId={e.match.id} />
                ) : null}
              </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="points-h" className="mb-8">
        <h2 id="points-h" className="mb-3 text-lg font-semibold">
          My points this season
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {points.map((p) => (
            <Link
              key={p.game}
              href={`/leaderboard/${GAME_CONFIG[p.game].slug}`}
              className="card-ds hover:bg-accent p-4"
            >
              <GameBadge game={p.game} />
              <p className="mt-2 text-2xl font-bold">{p.points}</p>
              <p className="text-muted-foreground text-xs">{p.matches} scored match(es)</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="teams-h" className="mb-8">
        <h2 id="teams-h" className="mb-3 text-lg font-semibold">
          My teams
        </h2>
        {teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No team yet.{" "}
            <Link href="/teams" className="text-primary underline">
              Create or join one
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/teams/${t.id}`}
                  className="min-h-tap border-border hover:bg-accent inline-flex items-center gap-2 rounded-lg border px-3"
                >
                  <GameBadge game={t.game} /> {t.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="winnings-h" className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="winnings-h" className="text-lg font-semibold">
            My winnings
          </h2>
          {winnings.rows.length ? (
            <p className="text-sm">
              Total paid: <strong className="text-gold">{formatINR(winnings.paidPaise)}</strong>
            </p>
          ) : null}
        </div>
        {winnings.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No prizes yet. Top places in tournaments, seasons and prize scrims pay out here.
          </p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-xl border text-sm">
            {winnings.rows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                {w.href ? (
                  <Link
                    href={w.href}
                    className="min-h-tap inline-flex items-center font-medium hover:underline"
                  >
                    {w.title}
                  </Link>
                ) : (
                  <span className="font-medium">{w.title}</span>
                )}
                <span className="text-muted-foreground">Place {w.place}</span>
                <span className="text-muted-foreground">{formatIST(w.date)}</span>
                <span className={w.status === "SUCCESS" ? "text-success" : ""}>
                  {PAYOUT_LABEL[w.status] ?? w.status}
                </span>
                <span className="text-gold ml-auto font-semibold">{formatINR(w.amountPaise)}</span>
              </li>
            ))}
          </ul>
        )}
        {winnings.rows.some((w) => w.status !== "SUCCESS") ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Prizes are paid to the payout method on your{" "}
            <Link href="/profile" className="text-primary underline">
              profile
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section aria-labelledby="history-h">
        <h2 id="history-h" className="mb-3 text-lg font-semibold">
          Match history
        </h2>
        <MatchHistoryList rows={history} empty="No past matches yet." />
      </section>
    </>
  );
}
