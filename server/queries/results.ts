import "server-only";
import { db } from "@/server/db";
import { isHeadToHead, type MatchMode } from "@/lib/match-modes";

/** Approved results for a completed match, with each entry's points. Public. */
export async function getPublicResults(matchId: string, mode: MatchMode) {
  const results = await db.result.findMany({
    where: { matchId, approvedAt: { not: null } },
    include: {
      registration: {
        select: {
          userId: true,
          user: { select: { id: true, displayName: true } },
          teamName: true,
          team: { select: { name: true } },
          members: {
            where: { status: "CONFIRMED" },
            select: { ign: true, user: { select: { id: true, displayName: true } } },
          },
        },
      },
    },
  });
  const points = await db.pointsEntry.findMany({
    where: { matchId },
    select: { userId: true, points: true },
  });
  const pointsOf = new Map(points.map((p) => [p.userId, p.points]));
  const rows = results.map((r) => ({
    id: r.id,
    name:
      r.registration.team?.name ??
      r.registration.teamName ??
      r.registration.user.displayName ??
      "Player",
    // Roster players entered by game ID may have no account (id null): shown by in-game name.
    players: r.registration.members.length
      ? r.registration.members.map((m) => ({
          id: m.user?.id ?? null,
          name: m.ign ?? m.user?.displayName ?? "Player",
        }))
      : [{ id: r.registration.user.id, name: r.registration.user.displayName ?? "Player" }],
    placement: r.placement,
    kills: r.kills,
    won: r.won,
    roundDiff: r.roundDiff,
    points: pointsOf.get(r.registration.userId) ?? 0,
  }));
  return isHeadToHead(mode)
    ? rows.sort((a, b) => Number(b.won) - Number(a.won))
    : rows.sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999));
}

/** Has this user got a CONFIRMED own registration (so they may submit a result)? */
export async function ownConfirmedRegistration(matchId: string, userId: string) {
  return db.registration.findFirst({
    where: { matchId, userId, status: "CONFIRMED" },
    include: { results: { where: { matchId } } },
  });
}

/** Did this user play in the match (own registration or roster)? Used for dispute eligibility. */
export async function playedInMatch(matchId: string, userId: string) {
  const reg = await db.registration.findFirst({
    where: {
      matchId,
      status: { in: ["CONFIRMED", "NO_SHOW"] },
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    select: { id: true },
  });
  return !!reg;
}
