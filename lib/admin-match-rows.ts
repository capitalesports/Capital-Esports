/**
 * Admin Matches list (DECISIONS M74): a tournament's sign-up list and all of its games (lobbies,
 * bracket rounds, final) show as one row that opens the tournament page; other matches stay one row
 * each. Pure, so the grouping is unit-tested.
 */
import type { MatchStatus } from "./match-state";

export interface AdminListMatch {
  id: string;
  startsAt: Date;
  status: MatchStatus;
  isEntryList: boolean;
  tournament: { id: string; title: string } | null;
  _count: { registrations: number };
}

export type AdminMatchRow<M extends AdminListMatch> =
  | { kind: "match"; match: M }
  | {
      kind: "tournament";
      id: string;
      title: string;
      /** Any match of the group, for game, mode and entry fee. */
      sample: M;
      startsAt: Date;
      /** Games played or to play (the sign-up list not counted). */
      games: number;
      /** Confirmed sign-ups, when the sign-up list is in the listing. */
      entries: number | null;
      status: MatchStatus;
    };

const OVER: MatchStatus[] = ["COMPLETED", "CANCELLED"];

/**
 * Where the tournament stands: the earliest game still running or to play; every game over means
 * completed; no games yet means the sign-up list's status.
 */
function groupStatus(matches: AdminListMatch[]): MatchStatus {
  const games = matches.filter((m) => !m.isEntryList);
  const open = games.find((m) => !OVER.includes(m.status));
  if (open) return games.some((m) => m.status === "LIVE") ? "LIVE" : open.status;
  if (games.some((m) => m.status === "COMPLETED")) return "COMPLETED";
  if (games.length) return "CANCELLED";
  return matches[0]!.status;
}

export function adminMatchRows<M extends AdminListMatch>(matches: M[]): AdminMatchRow<M>[] {
  const groups = new Map<string, M[]>();
  const rows: AdminMatchRow<M>[] = [];
  for (const m of matches) {
    if (!m.tournament) {
      rows.push({ kind: "match", match: m });
      continue;
    }
    const group = groups.get(m.tournament.id);
    if (group) {
      group.push(m);
      continue;
    }
    groups.set(m.tournament.id, [m]);
    // Placeholder at the tournament's first position; filled in below.
    rows.push({ kind: "tournament", id: m.tournament.id } as AdminMatchRow<M>);
  }
  return rows.map((row) => {
    if (row.kind === "match") return row;
    const group = groups.get(row.id)!;
    const sorted = [...group].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const entryList = group.find((m) => m.isEntryList);
    return {
      kind: "tournament",
      id: row.id,
      title: group[0]!.tournament!.title,
      sample: entryList ?? sorted[0]!,
      startsAt: sorted[0]!.startsAt,
      games: group.filter((m) => !m.isEntryList).length,
      entries: entryList ? entryList._count.registrations : null,
      status: groupStatus(sorted),
    };
  });
}
