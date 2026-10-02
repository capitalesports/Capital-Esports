import "server-only";
import { connection } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { catchUpMatchStatuses } from "@/server/jobs/status-catch-up";
import type { Game } from "@/lib/games";
import type { MatchMode } from "@/lib/match-schema";
import { startOfIstDay } from "@/lib/time";

/**
 * Columns safe to show anyone. Room credentials are deliberately absent: they are only ever
 * returned by server/services/room.ts.
 */
export const publicMatchSelect = {
  id: true,
  game: true,
  kind: true,
  mode: true,
  title: true,
  description: true,
  startsAt: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  maxSlots: true,
  entryFeePaise: true,
  prizePaise: true,
  status: true,
  streamUrl: true,
  cancelReason: true,
  resultsApprovedAt: true,
  tournamentId: true,
  isEntryList: true,
  bracketRound: true,
  parentMatchId: true,
  lobbyNumber: true,
  _count: {
    select: { registrations: { where: { status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } } } },
  },
} satisfies Prisma.MatchSelect;

export type PublicMatch = Prisma.MatchGetPayload<{ select: typeof publicMatchSelect }>;

export function confirmedCount(m: PublicMatch): number {
  return m._count.registrations;
}

/** Scrims from today (IST) through the next 3 days. */
export async function listUpcomingScrims(
  filters: { game?: Game | null; mode?: MatchMode | null } = {},
  now = new Date(),
) {
  await connection();
  await catchUpMatchStatuses();
  return db.match.findMany({
    where: {
      kind: "SCRIM",
      // Extra lobbies are shown on their listing's page, not as separate scrims.
      parentMatchId: null,
      status: { not: "CANCELLED" },
      startsAt: { gte: startOfIstDay(now), lt: startOfIstDay(now, 4) },
      game: filters.game ?? undefined,
      mode: filters.mode ?? undefined,
    },
    orderBy: { startsAt: "asc" },
    select: publicMatchSelect,
  });
}

export async function getPublicMatch(id: string) {
  await catchUpMatchStatuses();
  return db.match.findUnique({ where: { id }, select: publicMatchSelect });
}

/** The viewer's own relationship to a match: their registration, or their spot on someone's roster. */
export async function getViewerEntry(matchId: string, userId: string) {
  const [registration, rosterSpot] = await Promise.all([
    db.registration.findUnique({
      where: { matchId_userId: { matchId, userId } },
      include: {
        team: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, displayName: true } } } },
      },
    }),
    db.registrationMember.findUnique({
      where: { matchId_userId: { matchId, userId } },
      include: {
        registration: {
          include: {
            user: { select: { displayName: true } },
            team: { select: { name: true } },
            members: { include: { user: { select: { id: true, displayName: true } } } },
          },
        },
      },
    }),
  ]);
  return { registration, rosterSpot };
}

/**
 * Public entry list: confirmed entries in arrival order (team name or player display name, with the
 * id to link to) and the waitlist size. Never phone numbers or game IDs.
 */
export async function getRegisteredEntries(matchId: string) {
  const [confirmed, waitlisted] = await Promise.all([
    db.registration.findMany({
      where: { matchId, status: "CONFIRMED" },
      orderBy: { position: "asc" },
      select: {
        id: true,
        teamName: true,
        team: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true } },
      },
    }),
    db.registration.count({ where: { matchId, status: "WAITLISTED" } }),
  ]);
  return {
    entries: confirmed.map((r) =>
      r.team
        ? { id: r.id, name: r.team.name, href: `/teams/${r.team.id}` }
        : {
            id: r.id,
            // A roster the captain entered by game ID shows its team name, linking to the captain.
            name: r.teamName ?? r.user.displayName ?? "Player",
            href: `/players/${r.user.id}`,
          },
    ),
    waitlisted,
  };
}

/**
 * The lobbies of a split open-entry scrim (DECISIONS M11), listing first, and which one the viewer
 * plays in (own registration or roster spot). Null when the match was never split.
 */
export async function getLobbyGroup(
  match: Pick<PublicMatch, "id" | "parentMatchId" | "lobbyNumber">,
  userId: string | null,
) {
  if (match.lobbyNumber === null) return null;
  const rootId = match.parentMatchId ?? match.id;
  const lobbies = await db.match.findMany({
    where: { OR: [{ id: rootId }, { parentMatchId: rootId }] },
    orderBy: { lobbyNumber: "asc" },
    select: {
      id: true,
      title: true,
      lobbyNumber: true,
      status: true,
      _count: { select: { registrations: { where: { status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } } } } },
    },
  });
  const ids = lobbies.map((l) => l.id);
  const mine = userId
    ? await db.registration.findFirst({
        where: {
          matchId: { in: ids },
          status: { in: ["CONFIRMED", "PENDING_PAYMENT", "WAITLISTED"] },
          OR: [{ userId }, { members: { some: { userId } } }],
        },
        select: { matchId: true, status: true },
      })
    : null;
  return {
    root: lobbies.find((l) => l.id === rootId) ?? null,
    lobbies,
    myLobbyId: mine && mine.status !== "WAITLISTED" ? mine.matchId : null,
    /** A head-to-head side left without an opponent, waiting for an admin. */
    iAmUnplaced: mine?.status === "WAITLISTED",
  };
}

/** Waitlist rank (1-based) of a registration among WAITLISTED entries. */
export async function waitlistRank(matchId: string, position: number) {
  return (
    (await db.registration.count({
      where: { matchId, status: "WAITLISTED", position: { lt: position } },
    })) + 1
  );
}

/** Teams the user captains for a game, with confirmed members eligible to be picked. */
/** The saved team(s) the player is a confirmed member of for this game (captain or not). */
export async function getMyTeamsForGame(userId: string, game: Game) {
  return db.team.findMany({
    where: { game, members: { some: { userId, status: "CONFIRMED" } } },
    include: {
      members: {
        where: { status: "CONFIRMED", user: { deletedAt: null } },
        orderBy: { confirmedAt: "asc" },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              gameProfiles: { where: { game }, select: { game: true, gameId: true, ign: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Upcoming + past matches the user plays in (own registration or roster spot), tournament sign-ups
 * (entry lists) included so a registered team sees its tournament on the dashboard.
 */
export async function getMyMatches(userId: string) {
  await catchUpMatchStatuses();
  const regs = await db.registration.findMany({
    where: {
      OR: [{ userId }, { members: { some: { userId } } }],
      status: { in: ["PENDING", "PENDING_PAYMENT", "CONFIRMED", "WAITLISTED", "NO_SHOW"] },
    },
    include: {
      match: { select: { ...publicMatchSelect, tournament: { select: { title: true } } } },
      team: { select: { name: true } },
      members: { where: { userId }, select: { status: true } },
    },
    orderBy: { match: { startsAt: "asc" } },
  });
  return regs;
}
