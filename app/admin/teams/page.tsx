import type { Metadata } from "next";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { AutoSubmitSelect } from "@/components/admin/auto-submit-select";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { isPlausibleId } from "@/server/queries/teams";
import {
  listRegisteredTeams,
  listTeamRegistrationEvents,
  listTeams,
} from "@/server/services/admin-teams";
import { gameFromSlug, GAME_CONFIG, GAME_LIST } from "@/lib/games";
import { MODE_LABEL } from "@/lib/match-modes";
import { playerIdLabel } from "@/lib/player-label";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Teams" };

const lower = (s: string) => s.replace(/_/g, " ").toLowerCase();

type RegisteredTeam = Awaited<ReturnType<typeof listRegisteredTeams>>[number];

/** Registered teams (IGL first) and solo players, every player's ID shown once. */
function RegisteredTeamsTable({ rows, showEvent }: { rows: RegisteredTeam[]; showEvent: boolean }) {
  const allSolo = rows.every((r) => !r.team);
  const allTeams = rows.every((r) => r.team);
  return (
    <div className="card-ds overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{allSolo ? "Player" : allTeams ? "Team" : "Team / player"}</TableHead>
            <TableHead>{allSolo ? "Game ID" : "Players"}</TableHead>
            {showEvent ? <TableHead>Event</TableHead> : null}
            <TableHead>Status</TableHead>
            <TableHead>Registered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="align-top">
                {r.team ? (
                  <>
                    <span className="font-semibold">{r.teamName}</span>
                    {r.joinCode ? (
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {r.joinCode}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground block text-xs">
                      IGL{" "}
                      <Link href={`/admin/users/${r.igl.id}`} className="hover:underline">
                        {r.igl.name}
                      </Link>
                    </span>
                  </>
                ) : (
                  <Link href={`/admin/users/${r.igl.id}`} className="font-semibold hover:underline">
                    {r.teamName}
                  </Link>
                )}
              </TableCell>
              <TableCell className="align-top">
                <ol className="space-y-0.5 text-xs">
                  {r.players.map((p, i) => (
                    <li key={`${p.gameId ?? "p"}-${i}`}>
                      {p.igl ? <span className="text-gold mr-1 font-semibold">IGL</span> : null}
                      {playerIdLabel(r.match.game, p.gameId, p.ign)}
                      {p.hasAccount ? null : (
                        <span className="text-muted-foreground"> · no account</span>
                      )}
                      {p.status !== "CONFIRMED" ? (
                        <span className="text-muted-foreground"> · {lower(p.status)}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </TableCell>
              {showEvent ? (
                <TableCell className="align-top text-sm">
                  <span className="flex items-center gap-2">
                    <GameBadge game={r.match.game} />
                    <Link href={`/admin/teams?event=${r.match.id}`} className="hover:underline">
                      {r.match.name}
                    </Link>
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {r.match.kindLabel} · {MODE_LABEL[r.match.mode]}
                  </span>
                </TableCell>
              ) : null}
              <TableCell className="align-top text-sm whitespace-nowrap">
                {lower(r.status)}
              </TableCell>
              <TableCell className="text-muted-foreground align-top text-xs whitespace-nowrap">
                {formatIST(r.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AdminTeamsPage({ searchParams }: PageProps<"/admin/teams">) {
  const user = await requireStaffPage("/admin/teams");
  const actor = toActor(user);
  const sp = await searchParams;
  const game = typeof sp.game === "string" ? sp.game : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const event = typeof sp.event === "string" && isPlausibleId(sp.event) ? sp.event : null;
  const gameFilter = gameFromSlug(game);

  // One event's teams.
  if (event) {
    const rows = await listRegisteredTeams(actor, { matchId: event, q });
    const m = rows[0]?.match;
    const noun = rows[0]?.team === false ? "player" : "team";
    return (
      <>
        <Button asChild variant="ghost" className="mb-2 -ml-3">
          <Link href={game ? `/admin/teams?game=${game}` : "/admin/teams"}>
            <ArrowLeftIcon aria-hidden /> All events
          </Link>
        </Button>
        <PageHeader
          title={m ? m.name : "Registrations"}
          description={
            m
              ? `${m.kindLabel} · ${GAME_CONFIG[m.game].name} ${MODE_LABEL[m.mode]} · ${formatIST(m.startsAt)} · ${rows.length} ${noun}${rows.length === 1 ? "" : "s"} registered`
              : "No registrations for this event."
          }
        >
          <Button asChild variant="outline">
            <Link href={`/admin/matches/${event}`}>Open in Matches</Link>
          </Button>
        </PageHeader>
        {rows.length ? <RegisteredTeamsTable rows={rows} showEvent={false} /> : null}
      </>
    );
  }

  const [events, found, teams] = await Promise.all([
    q ? Promise.resolve([]) : listTeamRegistrationEvents(actor, { game: gameFilter }),
    q ? listRegisteredTeams(actor, { game: gameFilter, q }) : Promise.resolve([]),
    listTeams(actor, { game: gameFilter, q }),
  ]);
  const eventHref = (id: string) =>
    game ? `/admin/teams?game=${game}&event=${id}` : `/admin/teams?event=${id}`;

  return (
    <>
      <PageHeader
        title="Teams"
        description="Open a tournament, scrim or match to see every team or player registered for it. Search finds a team or player by name."
      />
      <form method="get" className="mb-6 flex flex-wrap gap-2" role="search">
        <AutoSubmitSelect name="game" defaultValue={game} aria-label="Game" className="w-40">
          <option value="">All games</option>
          {GAME_LIST.map((g) => (
            <option key={g.id} value={g.slug}>
              {g.name}
            </option>
          ))}
        </AutoSubmitSelect>
        <Input
          name="q"
          defaultValue={q}
          placeholder="Team or player name"
          aria-label="Team or player name"
          className="max-w-xs"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {q ? (
        <section aria-labelledby="found-heading" className="space-y-2">
          <h2 id="found-heading" className="text-lg font-semibold">
            Registrations matching “{q}” ({found.length})
          </h2>
          {found.length ? (
            <RegisteredTeamsTable rows={found} showEvent />
          ) : (
            <p className="text-muted-foreground text-sm">
              No registered team or player has that name.
            </p>
          )}
        </section>
      ) : (
        <section aria-labelledby="events-heading" className="space-y-2">
          <h2 id="events-heading" className="text-lg font-semibold">
            Registrations by event
          </h2>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No {gameFilter ? `${GAME_CONFIG[gameFilter].name} ` : ""}registrations yet.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={eventHref(e.id)}
                    className="card-ds-interactive flex items-center gap-3 p-4"
                  >
                    <span className="min-w-0 grow space-y-1">
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        <GameBadge game={e.game} />
                        <span className="text-gold font-semibold">{e.kindLabel}</span>
                        <span className="text-muted-foreground">{MODE_LABEL[e.mode]}</span>
                      </span>
                      <span className="block truncate font-semibold">{e.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatIST(e.startsAt)} · {lower(e.status)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="font-heading block text-2xl font-bold">{e.entries}</span>
                      <span className="text-muted-foreground text-xs">
                        {e.teamMode ? "team" : "player"}
                        {e.entries === 1 ? "" : "s"}
                      </span>
                    </span>
                    <ChevronRightIcon aria-hidden className="text-muted-foreground size-5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="profiles-heading" className="mt-8 space-y-2">
        <h2 id="profiles-heading" className="text-lg font-semibold">
          Saved team profiles
        </h2>
        <p className="text-muted-foreground text-sm">
          Teams players made on their Teams page; others join with the team code.
        </p>
        {teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No {gameFilter ? `${GAME_CONFIG[gameFilter].name} ` : ""}saved team profiles.
          </p>
        ) : (
          <div className="card-ds overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Captain</TableHead>
                  <TableHead className="text-right">Confirmed members</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <GameBadge game={t.game} />
                        <Link href={`/admin/teams/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.joinCode}</TableCell>
                    <TableCell>{t.captain.displayName ?? "—"}</TableCell>
                    <TableCell className="text-right">{t._count.members}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
