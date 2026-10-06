import { IntentLink as Link } from "@/components/common/intent-link";
import { StatusPill } from "@/components/match/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LobbyStanding } from "@/lib/tournament";
import { bracketLayout } from "@/lib/bracket-layout";
import { roundName } from "@/lib/tournament";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";
import type {
  BracketViewRound,
  TournamentLobby,
  TournamentMatch,
} from "@/server/services/tournament-queries";

/** Lobby tournaments after registration closed: one collapsible card per lobby (M50). */
export function LobbyList({
  lobbies,
  mine,
  unit,
}: {
  lobbies: TournamentLobby[];
  mine: number | null;
  /** What one entry is: "players", "squads" or "teams". */
  unit: string;
}) {
  return (
    <div className="space-y-3">
      {mine !== null ? (
        <p className="card-ds border-gold/60 text-gold p-3 font-semibold">
          You&apos;re in Lobby {mine}. Room ID and password appear on your dashboard.
        </p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lobbies.map((l) => (
          <li key={l.lobby}>
            <details className={cn("card-ds group p-3", l.lobby === mine ? "border-gold/60" : "")}>
              <summary className="min-h-tap flex cursor-pointer items-center justify-between gap-2 font-semibold">
                <span>Lobby {l.lobby}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {l.names.length} {unit}
                </span>
              </summary>
              <ol className="text-muted-foreground mt-2 list-decimal space-y-0.5 pl-5 text-sm">
                {l.names.map((n, i) => (
                  <li key={i} className="truncate">
                    {n}
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LobbyStandingsTable({ standings }: { standings: LobbyStanding[] }) {
  if (!standings.length)
    return (
      <p className="text-muted-foreground text-sm">
        Standings appear after the first match results are approved.
      </p>
    );
  return (
    <div className="card-ds overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Points</TableHead>
            <TableHead className="text-right">Matches</TableHead>
            <TableHead className="text-right">Wins</TableHead>
            <TableHead className="text-right">Kills</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((s) => (
            <TableRow key={s.unitKey}>
              <TableCell className="font-bold">{s.rank}</TableCell>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="text-right font-semibold">{s.points}</TableCell>
              <TableCell className="text-right">{s.matches}</TableCell>
              <TableCell className="text-right">{s.wins}</TableCell>
              <TableCell className="text-right">{s.kills}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const CARD_W = 208;
const CARD_H = 76;
const PITCH = 88;
const COL_GAP = 40;

/**
 * Single-elimination bracket with byes: cards placed by `bracketLayout` (each match between the
 * two it comes from) and joined by lines.
 */
export function BracketView({
  rounds,
  linkBase,
}: {
  rounds: BracketViewRound[];
  linkBase: string;
}) {
  const total = rounds.length;
  const layout = bracketLayout(
    rounds.map((r) => ({ matches: r.matches.length, byes: r.bye ? 1 : 0 })),
  );
  const width = rounds.length * CARD_W + (rounds.length - 1) * COL_GAP;
  const height = layout.height * PITCH - (PITCH - CARD_H);
  const x = (col: number) => col * (CARD_W + COL_GAP);
  const mid = (slot: number) => slot * PITCH + CARD_H / 2;
  return (
    <div
      className="overflow-x-auto pb-2"
      role="region"
      aria-label="Tournament bracket"
      tabIndex={0}
    >
      <ol className="flex gap-10" style={{ width }}>
        {rounds.map((r) => (
          <li key={r.round} className="w-52 shrink-0">
            <h3 className="text-muted-foreground text-sm font-semibold">
              {roundName(r.round, total)}
            </h3>
          </li>
        ))}
      </ol>
      <div className="relative mt-2" style={{ width, height }}>
        <svg
          aria-hidden
          className="text-gold/70 pointer-events-none absolute inset-0"
          width={width}
          height={height}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <defs>
            {/* Arrowhead where a winner (or a bye) enters the next round. */}
            <marker
              id="bracket-arrow"
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="currentColor" stroke="none" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            const x1 = x(e.fromCol) + CARD_W;
            const x2 = x(e.fromCol + 1);
            const xm = x1 + COL_GAP / 2;
            return (
              <path
                key={i}
                d={`M${x1} ${mid(e.fromY)} H${xm} V${mid(e.toY)} H${x2}`}
                markerEnd="url(#bracket-arrow)"
              />
            );
          })}
        </svg>
        {layout.columns.map((col, ci) =>
          col.items.map((item) => {
            const r = rounds[ci]!;
            const style = { left: x(ci), top: item.y * PITCH, width: CARD_W, height: CARD_H };
            if (item.kind === "bye") {
              return (
                <div
                  key={`${ci}-bye`}
                  style={style}
                  className="border-border bg-background absolute rounded-lg border border-dashed p-2 text-sm"
                >
                  <span className="block truncate font-medium">{r.bye}</span>
                  <span className="text-muted-foreground text-xs">
                    Bye: straight to the next round
                  </span>
                </div>
              );
            }
            const m = r.matches[item.index] ?? null;
            return (
              <div
                key={`${ci}-${item.index}`}
                style={style}
                className="border-border bg-card absolute rounded-lg border p-2 text-sm"
              >
                {m ? (
                  <Link href={`${linkBase}/${m.id}`} className="block space-y-0.5 hover:opacity-90">
                    {[0, 1].map((side) => {
                      const s = m.sides[side];
                      return (
                        <p
                          key={side}
                          className={cn(
                            "flex justify-between gap-2",
                            s?.won
                              ? "text-foreground font-bold"
                              : s?.won === false
                                ? "text-muted-foreground"
                                : "",
                          )}
                        >
                          <span className="truncate">{s?.name ?? "TBD"}</span>
                          {s?.won !== null && s?.won !== undefined ? (
                            <span>{s.won ? "W" : "L"}</span>
                          ) : null}
                        </p>
                      );
                    })}
                    <span className="text-muted-foreground block text-xs">
                      {formatIST(m.startsAt)}
                    </span>
                  </Link>
                ) : (
                  <p className="text-muted-foreground flex h-full items-center">TBD vs TBD</p>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function TournamentSchedule({
  matches,
  linkBase,
}: {
  matches: TournamentMatch[];
  linkBase: string;
}) {
  if (!matches.length)
    return <p className="text-muted-foreground text-sm">Match schedule coming soon.</p>;
  return (
    <ul className="space-y-2">
      {matches.map((m) => (
        <li
          key={m.id}
          className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
        >
          <Link href={`${linkBase}/${m.id}`} className="font-medium hover:underline">
            {m.title}
          </Link>
          <span className="text-muted-foreground">{formatIST(m.startsAt)}</span>
          <span className="ml-auto">
            <StatusPill status={m.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** YouTube watch/share URL -> privacy-enhanced embed URL, or null for anything else. */
export function youtubeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (u.hostname.endsWith("youtube.com"))
      id =
        u.searchParams.get("v") ??
        (u.pathname.startsWith("/live/") ? u.pathname.split("/")[2]! : null);
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

export function StreamEmbed({ url, title }: { url: string | null; title: string }) {
  const embed = youtubeEmbedUrl(url);
  if (!url) return null;
  if (!embed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-h-tap text-primary inline-flex items-center underline"
      >
        Watch the stream
      </a>
    );
  }
  return (
    <div className="card-ds aspect-video overflow-hidden">
      <iframe
        src={embed}
        title={`${title} stream`}
        className="size-full"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
