import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { assertAdmin, type Actor } from "@/lib/roles";
import { refreshLeaderboard } from "./leaderboard";
import { restoreNoShows } from "./results";

const deleteTournamentSchema = z.object({ tournamentId: z.string().min(1).max(64) });

/**
 * Delete a tournament for good (DECISIONS M59): its sign-up list, lobby and bracket matches,
 * registrations, results and points go with it. Money is never deleted: a tournament where an
 * entry fee was paid (or a UPI proof is waiting or approved), or whose prize payout is under way,
 * must be cancelled instead so players are refunded and the record stays.
 */
export async function deleteTournament(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { tournamentId } = parseInput(deleteTournamentSchema, input);
  return db.$transaction(async (tx) => {
    const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new AppError("NOT_FOUND", "Tournament not found.");
    const own = await tx.match.findMany({
      where: { OR: [{ tournamentId }, ...(t.entryMatchId ? [{ id: t.entryMatchId }] : [])] },
      select: { id: true },
    });
    const ownIds = own.map((m) => m.id);
    const lobbies = await tx.match.findMany({
      where: { parentMatchId: { in: ownIds }, id: { notIn: ownIds } },
      select: { id: true },
    });
    const ids = [...ownIds, ...lobbies.map((m) => m.id)];

    const [payments, proofs, lockedPayouts] = await Promise.all([
      tx.payment.count({ where: { matchId: { in: ids } } }),
      tx.manualPayment.count({
        where: { matchId: { in: ids }, status: { in: ["SUBMITTED", "APPROVED"] } },
      }),
      tx.payout.count({
        where: {
          AND: [
            { OR: [{ tournamentId }, { matchId: { in: ids } }] },
            { voidedAt: null },
            { OR: [{ status: { not: "PENDING" } }, { approvedAt: { not: null } }] },
          ],
        },
      }),
    ]);
    if (payments || proofs) {
      throw new AppError(
        "CONFLICT",
        "Players paid entry fees for this tournament, so it can't be deleted. Cancel it instead so they are refunded.",
      );
    }
    if (lockedPayouts) {
      throw new AppError(
        "CONFLICT",
        "This tournament's prize payout is already approved or being paid, so it can't be deleted.",
      );
    }

    const points = await tx.pointsEntry.findMany({
      where: { matchId: { in: ids } },
      select: { seasonId: true },
    });
    let noShowsRestored = 0;
    for (const id of ids) noShowsRestored += await restoreNoShows(tx, id);
    const { count: payoutsVoided } = await tx.payout.updateMany({
      where: { OR: [{ tournamentId }, { matchId: { in: ids } }], voidedAt: null },
      data: { voidedAt: new Date(), voidReason: "Tournament deleted" },
    });
    const registrations = await tx.registration.count({ where: { matchId: { in: ids } } });
    await tx.carouselItem.deleteMany({ where: { tournamentId } });
    await tx.match.deleteMany({ where: { id: { in: ids } } });
    await tx.tournament.delete({ where: { id: tournamentId } });
    for (const seasonId of new Set(points.map((p) => p.seasonId)))
      await refreshLeaderboard(tx, seasonId);
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.delete",
      entityType: "Tournament",
      entityId: tournamentId,
      before: { title: t.title, game: t.game, mode: t.mode, startsAt: t.startsAt },
      after: {
        matches: ids.length,
        registrations,
        pointsEntries: points.length,
        noShowsRestored,
        payoutsVoided,
      },
    });
    return { matches: ids.length, registrations };
  });
}
