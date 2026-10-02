import { IntentLink as Link } from "@/components/common/intent-link";
import { PlayerAvatar } from "@/components/common/player-avatar";
import { RankBadge } from "@/components/leaderboard/rank-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface StandingRow {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  team: string | null;
  points: number;
  matches: number;
  wins: number;
  kills: number;
  roundDiff: number;
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Design leaderboard table: # (crown for 1st), avatar + player, stats, points last in gold.
 * `compact` drops Team and Wins for the home page preview.
 */
export function StandingsTable({
  rows,
  battleRoyale,
  highlightUserId,
  compact = false,
}: {
  rows: StandingRow[];
  battleRoyale: boolean;
  highlightUserId?: string;
  compact?: boolean;
}) {
  const statLabel = battleRoyale ? "Kills" : "Round diff";
  return (
    <div className="card-ds overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="[&>th]:text-muted-foreground hover:bg-transparent [&>th]:text-xs [&>th]:font-medium">
            <TableHead className="w-12 text-center">#</TableHead>
            <TableHead>Player</TableHead>
            {compact ? null : <TableHead className="hidden sm:table-cell">Team</TableHead>}
            <TableHead className="text-right">Matches</TableHead>
            {compact ? null : <TableHead className="text-right">Wins</TableHead>}
            <TableHead className="text-right">{statLabel}</TableHead>
            <TableHead className="text-right">Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.userId}
              id={compact ? undefined : `player-${r.userId}`}
              className={cn(
                "scroll-mt-24 target:outline-gold target:outline-2 target:-outline-offset-2",
                r.userId === highlightUserId && "bg-gold/10",
              )}
            >
              <TableCell className="text-center">
                <RankBadge rank={r.rank} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-3">
                  <PlayerAvatar name={r.name} src={r.avatarUrl} />
                  <span className="min-w-0">
                    <Link
                      href={`/players/${r.userId}`}
                      className="hover:text-gold font-medium uppercase"
                    >
                      {r.name}
                    </Link>
                    {r.team && !compact ? (
                      <span className="text-muted-foreground block text-xs sm:hidden">
                        {r.team}
                      </span>
                    ) : null}
                  </span>
                </span>
              </TableCell>
              {compact ? null : (
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {r.team ?? "—"}
                </TableCell>
              )}
              <TableCell className="text-right">{r.matches}</TableCell>
              {compact ? null : <TableCell className="text-right">{r.wins}</TableCell>}
              <TableCell className="text-right">
                {battleRoyale ? r.kills : signed(r.roundDiff)}
              </TableCell>
              <TableCell className="text-right font-semibold">{r.points}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TiebreakNote({ battleRoyale }: { battleRoyale: boolean }) {
  return (
    <p className="text-muted-foreground text-xs">
      Ties broken by{" "}
      {battleRoyale
        ? "most wins, then most kills, then who reached the total first"
        : "most wins, then round difference"}
      .
    </p>
  );
}
