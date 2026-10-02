import { IntentLink as Link } from "@/components/common/intent-link";
import { GameBadge } from "@/components/game/game-badge";
import { StatusPill } from "@/components/match/status-pill";
import { isHeadToHead, MODE_LABEL } from "@/lib/match-modes";
import { formatIST } from "@/lib/time";
import type { HistoryRow } from "@/server/queries/dashboard";

/** "Won" / "Lost" for head-to-head, "#3 · 5 kills" for lobbies, null before results are approved. */
export function outcomeText(row: Pick<HistoryRow, "match" | "placement" | "kills" | "won">) {
  if (isHeadToHead(row.match.mode)) {
    return row.won === null ? null : row.won ? "Won" : "Lost";
  }
  if (row.placement === null) return null;
  return `#${row.placement} · ${row.kills ?? 0} kill${row.kills === 1 ? "" : "s"}`;
}

/** Past matches with mode, result and points earned (dashboard and public player page). */
export function MatchHistoryList({ rows, empty }: { rows: HistoryRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="divide-border border-border divide-y rounded-xl border text-sm">
      {rows.map((r) => {
        const outcome = outcomeText(r);
        return (
          <li key={r.registrationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <GameBadge game={r.match.game} />
            <Link
              href={`/scrims/${r.match.id}`}
              className="min-h-tap inline-flex items-center font-medium hover:underline"
            >
              {r.match.title}
            </Link>
            <span className="text-muted-foreground">{MODE_LABEL[r.match.mode]}</span>
            <span className="text-muted-foreground">{formatIST(r.match.startsAt)}</span>
            {r.status === "NO_SHOW" ? (
              <span className="text-destructive">No-show</span>
            ) : outcome ? (
              <span
                className={
                  r.won === true ? "text-success" : r.won === false ? "text-destructive" : ""
                }
              >
                {outcome}
              </span>
            ) : (
              <StatusPill status={r.match.status} />
            )}
            {r.points !== null ? (
              <span className="text-gold ml-auto font-semibold">
                {r.points > 0 ? "+" : ""}
                {r.points} pts
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
