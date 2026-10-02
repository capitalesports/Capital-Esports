import "server-only";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { canSeeRoomCredentials } from "@/lib/registration-rules";
import { roomNeedsPassword } from "@/lib/room-rules";
import { assertUser, type Actor } from "@/lib/roles";
import { isConfirmedPlayer } from "./registration";

export type RoomCredentialsResult =
  /** `roomPassword` is null for Valorant, whose room is a single code (DECISIONS M22). */
  | { visible: true; roomId: string; roomPassword: string | null }
  | { visible: false; reason: "NOT_CONFIRMED" | "NOT_SET" | "ENDED" };

/**
 * The only code path that returns room credentials to a player.
 * Confirmed players only, as soon as staff share them, until the match is over (DECISIONS M20).
 */
export async function getRoomCredentials(
  actor: Actor | null,
  matchId: string,
): Promise<RoomCredentialsResult> {
  const me = assertUser(actor);
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: { game: true, status: true, roomId: true, roomPassword: true },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  const confirmed = await isConfirmedPlayer(matchId, me.id);
  if (!confirmed) return { visible: false, reason: "NOT_CONFIRMED" };
  if (!canSeeRoomCredentials(match, confirmed)) return { visible: false, reason: "ENDED" };
  const needsPassword = roomNeedsPassword(match.game);
  if (!match.roomId || (needsPassword && !match.roomPassword)) {
    return { visible: false, reason: "NOT_SET" };
  }
  return {
    visible: true,
    roomId: match.roomId,
    roomPassword: needsPassword ? match.roomPassword : null,
  };
}
