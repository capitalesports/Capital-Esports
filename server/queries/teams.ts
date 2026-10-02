import "server-only";
import { db } from "@/server/db";

/** Row ids are cuids: anything else can't exist, so skip the query. */
export function isPlausibleId(id: string): boolean {
  return /^[a-z0-9]{8,40}$/i.test(id);
}

/**
 * Public team profile: name, game, captain, confirmed members (display names and avatars only —
 * never phone numbers or game IDs) and the team's recent approved results.
 */
export async function getPublicTeam(id: string) {
  if (!isPlausibleId(id)) return null;
  const team = await db.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      game: true,
      createdAt: true,
      captainId: true,
      members: {
        where: { status: "CONFIRMED", user: { deletedAt: null } },
        orderBy: { confirmedAt: "asc" },
        select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
    },
  });
  if (!team) return null;
  const results = await db.result.findMany({
    where: { teamId: id, approvedAt: { not: null }, match: { status: "COMPLETED" } },
    orderBy: { match: { startsAt: "desc" } },
    take: 10,
    select: {
      id: true,
      placement: true,
      kills: true,
      won: true,
      match: {
        select: { id: true, title: true, mode: true, startsAt: true, tournamentId: true },
      },
    },
  });
  return {
    id: team.id,
    name: team.name,
    game: team.game,
    createdAt: team.createdAt,
    captainId: team.captainId,
    members: team.members.map((m) => m.user),
    results,
  };
}
