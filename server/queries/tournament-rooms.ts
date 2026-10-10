import "server-only";
import { db } from "@/server/db";

/**
 * Admin only (staff page): every playable match of a tournament with its teams and room code, for
 * the "Team codes" panel (DECISIONS M60). A code set on a match is shown only to the teams in it.
 */
export async function listTournamentRooms(tournamentId: string) {
  const matches = await db.match.findMany({
    where: { tournamentId, isEntryList: false },
    orderBy: [
      { bracketRound: "asc" },
      { bracketIndex: "asc" },
      { startsAt: "asc" },
      { lobbyNumber: "asc" },
    ],
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      bracketRound: true,
      lobbyNumber: true,
      roomId: true,
      roomPassword: true,
      roomNoticeSentAt: true,
      registrations: {
        where: { status: "CONFIRMED" },
        orderBy: { position: "asc" },
        select: {
          teamName: true,
          team: { select: { name: true } },
          user: { select: { displayName: true } },
        },
      },
    },
  });
  return matches.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    startsAt: m.startsAt,
    round: m.bracketRound,
    lobby: m.lobbyNumber,
    roomId: m.roomId,
    roomPassword: m.roomPassword,
    sentAt: m.roomNoticeSentAt,
    teams: m.registrations.map((r) => r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player"),
  }));
}
