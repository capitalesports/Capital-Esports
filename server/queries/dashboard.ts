import "server-only";
import { db } from "@/server/db";
import type { Game } from "@/lib/games";
import type { MatchMode } from "@/lib/match-modes";
import type { MatchStatus } from "@/lib/match-state";

/** Registration statuses that mean the player took part (or was expected to). */
const PLAYED = ["CONFIRMED", "NO_SHOW"] as const;

/**
 * Matches waiting for my result: RESULTS_PENDING, my own CONFIRMED registration (solo player or
 * captain) and nothing submitted yet.
 */
export async function getResultsToSubmit(userId: string) {
  return db.registration.findMany({
    where: {
      userId,
      status: "CONFIRMED",
      results: { none: {} },
      match: { status: "RESULTS_PENDING", isEntryList: false },
    },
    select: {
      id: true,
      team: { select: { name: true } },
      match: { select: { id: true, title: true, game: true, mode: true, startsAt: true } },
    },
    orderBy: { match: { startsAt: "asc" } },
  });
}

export interface HistoryRow {
  registrationId: string;
  status: string;
  teamName: string | null;
  match: {
    id: string;
    title: string;
    game: Game;
    mode: MatchMode;
    status: MatchStatus;
    startsAt: Date;
  };
  placement: number | null;
  kills: number | null;
  won: boolean | null;
  points: number | null;
}

/**
 * Past matches a user played (own registration or confirmed roster spot), newest first, with the
 * approved result of their entry and the season points they earned from it.
 */
export async function getMatchHistory(
  userId: string,
  opts: { take?: number; completedOnly?: boolean; excludeMatchIds?: string[] } = {},
): Promise<HistoryRow[]> {
  const regs = await db.registration.findMany({
    where: {
      OR: [{ userId }, { members: { some: { userId, status: "CONFIRMED" } } }],
      status: { in: [...PLAYED] },
      match: {
        isEntryList: false,
        id: opts.excludeMatchIds?.length ? { notIn: opts.excludeMatchIds } : undefined,
        status: opts.completedOnly
          ? "COMPLETED"
          : { in: ["RESULTS_PENDING", "COMPLETED", "CANCELLED"] },
      },
    },
    select: {
      id: true,
      status: true,
      team: { select: { name: true } },
      match: {
        select: { id: true, title: true, game: true, mode: true, status: true, startsAt: true },
      },
      results: {
        where: { approvedAt: { not: null } },
        select: { placement: true, kills: true, won: true },
        take: 1,
      },
    },
    orderBy: { match: { startsAt: "desc" } },
    take: opts.take ?? 20,
  });
  const points = await db.pointsEntry.findMany({
    where: { userId, matchId: { in: regs.map((r) => r.match.id) } },
    select: { matchId: true, points: true, kills: true },
  });
  const byMatch = new Map(points.map((p) => [p.matchId, p]));
  return regs.map((r) => {
    const result = r.results[0];
    const entry = byMatch.get(r.match.id);
    return {
      registrationId: r.id,
      status: r.status,
      teamName: r.team?.name ?? null,
      match: r.match,
      placement: result?.placement ?? null,
      kills: result?.kills ?? null,
      won: result?.won ?? null,
      points: entry?.points ?? null,
    };
  });
}

/** My prizes (tournament, season and scrim), newest first; voided payouts are left out. */
export async function getMyWinnings(userId: string) {
  const payouts = await db.payout.findMany({
    where: { userId, voidedAt: null },
    select: {
      id: true,
      tournamentId: true,
      seasonId: true,
      matchId: true,
      place: true,
      amountPaise: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const ids = <K extends "tournamentId" | "seasonId" | "matchId">(k: K) =>
    payouts.map((p) => p[k]).filter((v): v is string => !!v);
  const [tournaments, seasons, matches] = await Promise.all([
    db.tournament.findMany({
      where: { id: { in: ids("tournamentId") } },
      select: { id: true, title: true },
    }),
    db.season.findMany({
      where: { id: { in: ids("seasonId") } },
      select: { id: true, name: true },
    }),
    db.match.findMany({
      where: { id: { in: ids("matchId") } },
      select: { id: true, title: true },
    }),
  ]);
  const title = new Map<string, string>([
    ...tournaments.map((t) => [t.id, t.title] as const),
    ...seasons.map((s) => [s.id, `${s.name} (season)`] as const),
    ...matches.map((m) => [m.id, m.title] as const),
  ]);
  const rows = payouts.map((p) => {
    const sourceId = p.tournamentId ?? p.seasonId ?? p.matchId;
    return {
      id: p.id,
      title: (sourceId && title.get(sourceId)) ?? "Prize",
      href: p.matchId ? `/scrims/${p.matchId}` : null,
      place: p.place,
      amountPaise: p.amountPaise,
      status: p.status,
      date: p.status === "SUCCESS" ? p.updatedAt : p.createdAt,
    };
  });
  const paidPaise = rows
    .filter((r) => r.status === "SUCCESS")
    .reduce((sum, r) => sum + r.amountPaise, 0);
  return { rows, paidPaise };
}
