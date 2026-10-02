import "server-only";
import { z } from "zod";
import type { RegistrationStatus } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import type { Game } from "@/lib/games";
import { isTeamMode } from "@/lib/match-modes";
import type { MatchStatus } from "@/lib/match-state";
import { assertModerator, type Actor } from "@/lib/roles";

export async function listTeams(actor: Actor | null, filters: { game?: Game | null; q?: string }) {
  assertModerator(actor);
  return db.team.findMany({
    where: {
      game: filters.game ?? undefined,
      name: filters.q ? { contains: filters.q, mode: "insensitive" } : undefined,
    },
    include: {
      captain: { select: { id: true, displayName: true } },
      _count: { select: { members: { where: { status: "CONFIRMED" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/** Active entries of every kind: solo players, captain-entered rosters and saved teams. */
function entryWhere(filters: { game?: Game | null }) {
  return {
    status: { not: "CANCELLED" as const },
    match: { game: filters.game ?? undefined },
  };
}

/**
 * Events (tournament sign-ups, scrims, matches) with registrations, newest first, with how many
 * entries (teams, or players in solo modes) they have. The admin Teams page lists these first;
 * opening one shows its entries (DECISIONS M16).
 */
export async function listTeamRegistrationEvents(
  actor: Actor | null,
  filters: { game?: Game | null },
) {
  assertModerator(actor);
  const counts = await db.registration.groupBy({
    by: ["matchId"],
    where: entryWhere(filters),
    _count: { _all: true },
  });
  if (!counts.length) return [];
  const matches = await db.match.findMany({
    where: { id: { in: counts.map((c) => c.matchId) } },
    select: {
      id: true,
      title: true,
      game: true,
      kind: true,
      mode: true,
      status: true,
      startsAt: true,
      isEntryList: true,
      tournament: { select: { title: true } },
    },
    orderBy: { startsAt: "desc" },
  });
  const byMatch = new Map(counts.map((c) => [c.matchId, c._count._all]));
  return matches.map((m) => ({
    id: m.id,
    game: m.game,
    mode: m.mode,
    status: m.status,
    startsAt: m.startsAt,
    ...eventLabel(m),
    /** Team modes count teams; Solo/Duo/1v1 count players. */
    teamMode: isTeamMode(m.mode),
    entries: byMatch.get(m.id) ?? 0,
  }));
}

/** "Tournament" / "Scrim" / "Match" and the name admins know the event by. */
export function eventLabel(m: {
  title: string;
  kind: string;
  isEntryList: boolean;
  tournament: { title: string } | null;
}) {
  if (m.isEntryList || (m.tournament && m.kind === "TOURNAMENT")) {
    return { kindLabel: "Tournament", name: m.tournament?.title ?? m.title };
  }
  return { kindLabel: m.kind === "SCRIM" ? "Scrim" : "Match", name: m.title };
}

/**
 * Registrations (DECISIONS M13, M16): team rosters with the IGL and each player's game ID and exact
 * in-game name (not Team records), and solo entries with the player's own game ID. Search matches a
 * team name or a player's display name.
 */
export async function listRegisteredTeams(
  actor: Actor | null,
  filters: { game?: Game | null; q?: string; matchId?: string },
) {
  assertModerator(actor);
  const contains = filters.q ? { contains: filters.q, mode: "insensitive" as const } : null;
  const regs = await db.registration.findMany({
    where: {
      ...entryWhere(filters),
      matchId: filters.matchId,
      OR: contains
        ? [
            { teamName: contains },
            { team: { name: contains } },
            { user: { displayName: contains } },
          ]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      teamName: true,
      status: true,
      createdAt: true,
      userId: true,
      team: { select: { name: true, joinCode: true } },
      user: {
        select: {
          id: true,
          displayName: true,
          gameProfiles: { select: { game: true, gameId: true, ign: true } },
        },
      },
      match: {
        select: {
          id: true,
          title: true,
          game: true,
          mode: true,
          startsAt: true,
          kind: true,
          isEntryList: true,
          tournament: { select: { id: true, title: true } },
        },
      },
      members: {
        orderBy: { id: "asc" },
        select: {
          userId: true,
          gameId: true,
          ign: true,
          status: true,
          user: {
            select: {
              displayName: true,
              gameProfiles: { select: { game: true, gameId: true, ign: true } },
            },
          },
        },
      },
    },
  });
  return regs.map((r) => {
    const team = isTeamMode(r.match.mode);
    const own = r.user.gameProfiles.find((p) => p.game === r.match.game);
    return {
      id: r.id,
      /** Team modes: the team; solo modes: the player. */
      team,
      teamName: team ? (r.team?.name ?? r.teamName ?? "—") : (r.user.displayName ?? "Player"),
      /** Set when the roster came from a saved team. */
      joinCode: r.team?.joinCode ?? null,
      status: r.status,
      createdAt: r.createdAt,
      igl: { id: r.user.id, name: r.user.displayName ?? "Player" },
      match: { ...r.match, ...eventLabel(r.match) },
      // A solo entry has no roster rows: the player's own game ID.
      players: !r.members.length
        ? [
            {
              igl: false,
              gameId: own?.gameId ?? null,
              ign: own?.ign ?? null,
              account: r.user.displayName,
              hasAccount: true,
              status: "CONFIRMED" as const,
            },
          ]
        : // The IGL (the captain who registered) first, then the other players.
          [...r.members]
            .sort((a, b) => Number(b.userId === r.userId) - Number(a.userId === r.userId))
            .map((m) => {
              // Older rosters (members confirmed per match) have no game ID of their own: use the profile.
              const profile = m.gameId
                ? null
                : m.user?.gameProfiles.find((p) => p.game === r.match.game);
              return {
                igl: m.userId === r.userId,
                gameId: m.gameId ?? profile?.gameId ?? null,
                ign: m.ign ?? profile?.ign ?? null,
                account: m.user?.displayName ?? null,
                hasAccount: !!m.userId,
                status: m.status,
              };
            }),
    };
  });
}

export async function getTeamDetail(actor: Actor | null, teamId: string) {
  assertModerator(actor);
  const team = await db.team.findUnique({
    where: { id: teamId },
    include: {
      captain: { select: { id: true, displayName: true } },
      members: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              gameProfiles: { select: { game: true, gameId: true, ign: true } },
            },
          },
        },
        orderBy: { invitedAt: "asc" },
      },
    },
  });
  if (!team) throw new AppError("NOT_FOUND", "Team not found.");
  return team;
}

const memberSchema = z.object({ teamId: z.string().min(1), userId: z.string().min(1) });

export async function adminRemoveTeamMember(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { teamId, userId } = parseInput(memberSchema, input);
  await db.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError("NOT_FOUND", "Team not found.");
    if (team.captainId === userId) {
      throw new AppError("CONFLICT", "Transfer the captaincy before removing the captain.");
    }
    const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!member) throw new AppError("NOT_FOUND", "This player is not in the team.");
    await tx.teamMember.delete({ where: { id: member.id } });
    const rosterRemoved = await removeFromUpcomingRosters(tx, teamId, userId);
    await writeAudit(tx, {
      actorId: me.id,
      action: "team.removeMember",
      entityType: "Team",
      entityId: teamId,
      before: member,
      after: { rosterRemoved },
    });
  });
}

const NOT_STARTED: MatchStatus[] = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];
const ACTIVE: RegistrationStatus[] = ["PENDING", "PENDING_PAYMENT", "CONFIRMED", "WAITLISTED"];

/** A player who left the team no longer plays for it in matches that have not started. */
export async function removeFromUpcomingRosters(tx: Tx, teamId: string, userId: string) {
  const { count } = await tx.registrationMember.deleteMany({
    where: {
      userId,
      registration: { teamId, match: { status: { in: NOT_STARTED } } },
    },
  });
  return count;
}

export async function adminTransferCaptain(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { teamId, userId } = parseInput(memberSchema, input);
  await db.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError("NOT_FOUND", "Team not found.");
    const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!member || member.status !== "CONFIRMED") {
      throw new AppError("VALIDATION", "The new captain must be a confirmed member of the team.");
    }
    await tx.team.update({ where: { id: teamId }, data: { captainId: userId } });
    const moved = await moveUpcomingRegistrations(tx, teamId, team.captainId, userId);
    await writeAudit(tx, {
      actorId: me.id,
      action: "team.transferCaptain",
      entityType: "Team",
      entityId: teamId,
      before: { captainId: team.captainId },
      after: { captainId: userId, movedRegistrations: moved.moved, skipped: moved.skipped },
    });
  });
}

/**
 * The team's upcoming registrations now belong to the new captain (who submits results and pays).
 * A match where the new captain already has a registration row of their own (one per player per
 * match) is skipped and reported in the audit entry.
 */
export async function moveUpcomingRegistrations(tx: Tx, teamId: string, from: string, to: string) {
  const regs = await tx.registration.findMany({
    where: {
      teamId,
      userId: from,
      status: { in: ACTIVE },
      match: { status: { in: NOT_STARTED } },
    },
    select: { id: true, matchId: true },
  });
  const moved: string[] = [];
  const skipped: string[] = [];
  for (const r of regs) {
    const clash = await tx.registration.findUnique({
      where: { matchId_userId: { matchId: r.matchId, userId: to } },
    });
    if (clash) {
      skipped.push(r.id);
      continue;
    }
    await tx.registration.update({ where: { id: r.id }, data: { userId: to } });
    moved.push(r.id);
  }
  return { moved, skipped };
}
