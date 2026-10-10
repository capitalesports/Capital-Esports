import "server-only";
import { db } from "@/server/db";
import { publicMatchSelect } from "./matches";

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 64;

/** Normalise the navbar query; null when too short to search. */
export function normaliseQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Control characters (e.g. a NUL from "%00") would crash the database query: drop them.
  const q = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, SEARCH_MAX);
  return q.length >= SEARCH_MIN ? q : null;
}

/**
 * Public search across players (display name / in-game name), teams and matches.
 * Returns only public fields — never phone numbers or game account IDs.
 */
export async function searchSite(q: string) {
  const contains = { contains: q, mode: "insensitive" as const };
  const [players, teams, matches] = await Promise.all([
    db.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ displayName: contains }, { gameProfiles: { some: { ign: contains } } }],
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        gameProfiles: { select: { game: true } },
      },
      take: 10,
    }),
    db.team.findMany({
      where: { name: contains },
      select: {
        id: true,
        name: true,
        game: true,
        _count: { select: { members: { where: { status: "CONFIRMED" } } } },
      },
      take: 10,
    }),
    db.match.findMany({
      where: { title: contains, isEntryList: false },
      select: publicMatchSelect,
      orderBy: { startsAt: "desc" },
      take: 10,
    }),
  ]);
  return { players, teams, matches };
}
