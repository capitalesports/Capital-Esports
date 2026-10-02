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
import { roundName } from "@/lib/tournament";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TournamentMatch } from "@/server/services/tournament-queries";

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

export function BracketView({
  rounds,
  linkBase,
}: {
  rounds: { round: number; matches: (TournamentMatch | null)[] }[];
  linkBase: string;
}) {
  const total = rounds.length;
  return (
    <div
      className="overflow-x-auto pb-2"
      role="region"
      aria-label="Tournament bracket"
      tabIndex={0}
    >
      <ol className="flex min-w-max gap-4">
        {rounds.map((r) => (
          <li key={r.round} className="flex w-56 flex-col">
            <h3 className="text-muted-foreground mb-2 text-sm font-semibold">
              {roundName(r.round, total)}
            </h3>
            <ul className="flex flex-1 flex-col justify-around gap-3">
              {r.matches.map((m, i) => (
                <li key={i} className="border-border bg-card rounded-lg border p-2 text-sm">
                  {m ? (
                    <Link href={`${linkBase}/${m.id}`} className="block space-y-1 hover:opacity-90">
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
                    <p className="text-muted-foreground">TBD vs TBD</p>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
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
