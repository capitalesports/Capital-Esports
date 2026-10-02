import "server-only";
import { connection } from "next/server";
import { db, type Tx } from "@/server/db";
import { publicMatchSelect } from "@/server/queries/matches";
import type { Game } from "@/lib/games";
import { brPoints } from "@/lib/points";
import {
  lobbyStandings,
  mondayOfIstWeek,
  roundCount,
  type BracketSize,
  type LobbyStanding,
} from "@/lib/tournament";
import { pointsConfigFor } from "./leaderboard";

type Reader = Tx | typeof db;

/** Cumulative tournament standings from approved results of the linked lobby matches. */
export async function lobbyStandingsFor(
  reader: Reader,
  tournamentId: string,
): Promise<LobbyStanding[]> {
  const t = await reader.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { game: true },
  });
  const config = await pointsConfigFor(reader as Tx, t.game);
  const results = await reader.result.findMany({
    where: { approvedAt: { not: null }, match: { tournamentId, isEntryList: false } },
    include: {
      registration: {
        select: {
          userId: true,
          teamId: true,
          teamName: true,
          team: { select: { name: true } },
          user: { select: { displayName: true } },
        },
      },
    },
  });
  return lobbyStandings(
    results.map((r) => ({
      unitKey: r.registration.teamId ?? r.registration.userId,
      name:
        r.registration.team?.name ??
        r.registration.teamName ??
        r.registration.user.displayName ??
        "Player",
      matchId: r.matchId,
      placement: r.placement ?? 0,
      kills: r.kills ?? 0,
      points: brPoints(config, { placement: r.placement ?? 0, kills: r.kills ?? 0 }, true),
    })),
  );
}

const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * Current tournaments for a game (one per mode is allowed each week): this week's and next
 * week's, cancelled ones excluded, soonest first. Falls back to the nearest later week.
 */
export async function getCurrentTournaments(game: Game, now = new Date()) {
  await connection();
  const monday = mondayOfIstWeek(now);
  const nextMonday = new Date(monday.getTime() + WEEK_MS);
  const current = await db.tournament.findMany({
    where: { game, cancelledAt: null, weekOf: { gte: monday, lte: nextMonday } },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });
  if (current.length) return current;
  const later = await db.tournament.findFirst({
    where: { game, cancelledAt: null, weekOf: { gt: nextMonday } },
    orderBy: { weekOf: "asc" },
    select: { weekOf: true },
  });
  if (!later) return [];
  return db.tournament.findMany({
    where: { game, cancelledAt: null, weekOf: later.weekOf },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });
}

/** The soonest current tournament for a game (see getCurrentTournaments). */
export async function getCurrentTournament(game: Game, now = new Date()) {
  return (await getCurrentTournaments(game, now))[0] ?? null;
}

export async function listPastTournaments(game: Game, now = new Date()) {
  return db.tournament.findMany({
    where: { game, cancelledAt: null, weekOf: { lt: mondayOfIstWeek(now) } },
    orderBy: { weekOf: "desc" },
    take: 52,
  });
}

/** Linked lobby matches (BR) or bracket matches (Valorant) with entrants and winners. */
export async function getTournamentMatches(tournamentId: string) {
  const matches = await db.match.findMany({
    where: { tournamentId, isEntryList: false },
    orderBy: [{ bracketRound: "asc" }, { bracketIndex: "asc" }, { startsAt: "asc" }],
    select: {
      ...publicMatchSelect,
      bracketRound: true,
      bracketIndex: true,
      registrations: {
        where: { status: { in: ["CONFIRMED", "NO_SHOW"] } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          teamName: true,
          team: { select: { name: true } },
          user: { select: { displayName: true } },
          results: { where: { approvedAt: { not: null } }, select: { won: true, roundDiff: true } },
        },
      },
    },
  });
  return matches.map((m) => ({
    ...m,
    sides: m.registrations.map((r) => ({
      name: r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player",
      won: r.results[0]?.won ?? null,
      roundDiff: r.results[0]?.roundDiff ?? null,
    })),
  }));
}

export type TournamentMatch = Awaited<ReturnType<typeof getTournamentMatches>>[number];

/** Bracket rounds with a placeholder for every slot not yet created. */
export function bracketRounds(size: number, matches: TournamentMatch[]) {
  const total = roundCount(size as BracketSize);
  return Array.from({ length: total }, (_, i) => {
    const round = i + 1;
    const slots = size / 2 ** round;
    return {
      round,
      matches: Array.from(
        { length: slots },
        (_, index) =>
          matches.find((m) => m.bracketRound === round && m.bracketIndex === index) ?? null,
      ),
    };
  });
}
