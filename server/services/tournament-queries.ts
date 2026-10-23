import "server-only";
import { connection } from "next/server";
import { db, type Tx } from "@/server/db";
import { publicMatchSelect } from "@/server/queries/matches";
import type { Game } from "@/lib/games";
import { brPoints } from "@/lib/points";
import {
  lobbyStandings,
  mondayOfIstWeek,
  bracketSlots,
  readyBracketPairs,
  walkBracket,
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
 * Current tournaments for a game (any number per mode and week): this week's and next
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

/**
 * Every tournament not yet started whose registration is open or opens later, soonest first, with
 * its sign-up list's times and fee (the /tournament index list).
 */
export async function listUpcomingTournaments() {
  await connection();
  const list = await db.tournament.findMany({
    where: {
      cancelledAt: null,
      winnersPublishedAt: null,
      entryList: { status: { in: ["UPCOMING", "REGISTRATION_OPEN"] } },
    },
    orderBy: { startsAt: "asc" },
    take: 30,
    select: {
      id: true,
      game: true,
      mode: true,
      title: true,
      startsAt: true,
      prizePoolPaise: true,
      entryList: {
        select: {
          status: true,
          registrationOpensAt: true,
          registrationClosesAt: true,
          entryFeePaise: true,
        },
      },
    },
  });
  return list.flatMap((t) => (t.entryList ? [{ ...t, entry: t.entryList }] : []));
}

/** Tournaments with their sign-up list's status, times and fee, for tournament cards (M68). */
export async function withEntryInfo<T extends { entryMatchId: string | null }>(list: T[]) {
  const ids = list.flatMap((t) => (t.entryMatchId ? [t.entryMatchId] : []));
  const entries = await db.match.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      entryFeePaise: true,
    },
  });
  const byId = new Map(entries.map((e) => [e.id, e]));
  return list.map((t) => ({ ...t, entry: (t.entryMatchId && byId.get(t.entryMatchId)) || null }));
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
      registrationId: r.id,
      name: r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player",
      won: r.results[0]?.won ?? null,
      roundDiff: r.results[0]?.roundDiff ?? null,
    })),
  }));
}

export type TournamentMatch = Awaited<ReturnType<typeof getTournamentMatches>>[number];

/**
 * The viewer's own entries in a tournament's games (as the registrant or a confirmed teammate), so
 * the bracket can highlight their team.
 */
export async function myTournamentEntryIds(
  tournamentId: string,
  userId: string,
): Promise<string[]> {
  const regs = await db.registration.findMany({
    where: {
      match: { tournamentId, isEntryList: false },
      OR: [{ userId }, { members: { some: { userId, status: "CONFIRMED" } } }],
    },
    select: { id: true },
  });
  return regs.map((r) => r.id);
}

/** A bracket entrant: its team, or the solo player. */
export function unitOf(r: { teamId: string | null; userId: string }): string {
  return r.teamId ?? r.userId;
}

/**
 * Where a bracket stands (DECISIONS M50): the confirmed sign-ups in sign-up order are round 1;
 * each decided round feeds the next (byes follow from the counts, nothing extra is stored).
 */
export async function bracketState(reader: Reader, entryMatchId: string, tournamentId: string) {
  const [entries, matches] = await Promise.all([
    reader.registration.findMany({
      where: { matchId: entryMatchId, status: "CONFIRMED" },
      orderBy: { position: "asc" },
      select: {
        userId: true,
        teamId: true,
        teamName: true,
        team: { select: { name: true } },
        user: { select: { displayName: true } },
      },
    }),
    reader.match.findMany({
      where: { tournamentId, bracketRound: { not: null } },
      select: {
        bracketRound: true,
        bracketIndex: true,
        status: true,
        results: {
          where: { approvedAt: { not: null }, won: true },
          select: { registration: { select: { teamId: true, userId: true } } },
        },
      },
    }),
  ]);
  const winners = new Map(
    matches.map((m) => {
      const w = m.results[0]?.registration;
      return [`${m.bracketRound}:${m.bracketIndex}`, w ? unitOf(w) : null];
    }),
  );
  const names = new Map(
    entries.map((e) => [unitOf(e), e.team?.name ?? e.teamName ?? e.user.displayName ?? "Player"]),
  );
  // Cancelled without a winner (both sides disqualified): nobody goes through (DECISIONS M73).
  const voids = new Set(
    matches
      .filter((m) => m.status === "CANCELLED" && !m.results.length)
      .map((m) => `${m.bracketRound}:${m.bracketIndex}`),
  );
  const winnerOf = (r: number, i: number) => winners.get(`${r}:${i}`) ?? null;
  const isVoid = (r: number, i: number) => voids.has(`${r}:${i}`);
  const units = entries.map(unitOf);
  const rounds = walkBracket(units, winnerOf, isVoid);
  const slots = bracketSlots(units, winnerOf, isVoid);
  return {
    entrants: entries.length,
    names,
    rounds,
    isVoid,
    ready: readyBracketPairs(units, winnerOf, isVoid),
    slots,
    /** Rounds in the whole bracket, void games taken out. */
    totalRounds: slots.length,
  };
}

export interface BracketViewRound {
  round: number;
  matches: (TournamentMatch | null)[];
  /** Who skips this round: a name, "TBD" while unknown, or null when nobody does. */
  bye: string | null;
  /** Games not created yet: who already won through to each side (null = still playing). */
  waiting: [string | null, string | null][];
  /** Void games (cancelled, nobody went through): left out of the drawing (M73). */
  voids: number[];
}

/** Every round of the bracket, with a placeholder for each match not created yet. */
export function bracketRounds(
  state: Awaited<ReturnType<typeof bracketState>>,
  matches: TournamentMatch[],
): BracketViewRound[] {
  const nameOf = (unit: string | null) => (unit ? (state.names.get(unit) ?? "Player") : null);
  return state.slots.map((slots, r) => {
    const shape = { round: r + 1, matches: Math.floor(slots.length / 2), byes: slots.length % 2 };
    const byeUnit = shape.byes ? (slots[slots.length - 1] ?? null) : null;
    return {
      round: shape.round,
      matches: Array.from(
        { length: shape.matches },
        (_, index) =>
          matches.find((m) => m.bracketRound === shape.round && m.bracketIndex === index) ?? null,
      ),
      bye: shape.byes ? (nameOf(byeUnit) ?? "TBD") : null,
      waiting: Array.from({ length: shape.matches }, (_, i) => [
        nameOf(slots[2 * i] ?? null),
        nameOf(slots[2 * i + 1] ?? null),
      ]),
      voids: Array.from({ length: shape.matches }, (_, i) => i).filter((i) =>
        state.isVoid(shape.round, i),
      ),
    };
  });
}

export interface TournamentLobby {
  lobby: number;
  /** Team names (team modes) or player names, in seat order. */
  names: string[];
}

/**
 * Lobby tournaments after registration closed (DECISIONS M50): who is in which lobby (taken from
 * the first match; players keep their lobby in every match), and the viewer's own lobby.
 */
export async function getTournamentLobbies(tournamentId: string, viewerId: string | null) {
  const first = await db.match.findFirst({
    where: {
      tournamentId,
      isEntryList: false,
      parentMatchId: null,
      bracketRound: null,
      lobbyNumber: { not: null },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  if (!first) return { lobbies: [] as TournamentLobby[], mine: null };
  const matches = await db.match.findMany({
    where: { OR: [{ id: first.id }, { parentMatchId: first.id }] },
    orderBy: { lobbyNumber: "asc" },
    select: {
      lobbyNumber: true,
      registrations: {
        where: { status: { in: ["CONFIRMED", "NO_SHOW"] } },
        orderBy: { position: "asc" },
        select: {
          userId: true,
          teamName: true,
          team: { select: { name: true } },
          user: { select: { displayName: true } },
          members: { select: { userId: true } },
        },
      },
    },
  });
  let mine: number | null = null;
  const lobbies = matches.map((m) => {
    const lobby = m.lobbyNumber ?? 1;
    if (
      viewerId &&
      m.registrations.some(
        (r) => r.userId === viewerId || r.members.some((x) => x.userId === viewerId),
      )
    )
      mine = lobby;
    return {
      lobby,
      names: m.registrations.map(
        (r) => r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player",
      ),
    };
  });
  return { lobbies, mine: mine as number | null };
}
