import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { isHeadToHead } from "@/lib/match-modes";
import { assertAdmin, type Actor } from "@/lib/roles";
import { transitionMatchStatus } from "./matches";
import { approveResults, saveResultRows } from "./results";

const rounds = z.coerce.number().int("Whole rounds only").min(0).max(13, "At most 13 rounds");
const winnerSchema = z
  .object({
    matchId: z.string().min(1).max(64),
    winnerRegistrationId: z.string().min(1).max(64),
    /** Score in rounds (optional): the round difference is the points tie-breaker. */
    winnerRounds: rounds.optional(),
    loserRounds: rounds.optional(),
  })
  .refine(
    (v) =>
      v.winnerRounds === undefined || v.loserRounds === undefined || v.winnerRounds > v.loserRounds,
    { message: "The winner must have more rounds", path: ["winnerRounds"] },
  );

/**
 * Admin, one click (DECISIONS M65): the winner of a two-team bracket game (Clash Squad, TDM,
 * Valorant). Runs the normal steps — live, results pending, the result, approval — so points,
 * the next bracket round and notifications work as usual. The game's room details are removed:
 * nobody needs them any more, and the next round gets its own code.
 */
export async function declareWinner(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { matchId, winnerRegistrationId, winnerRounds, loserRounds } = parseInput(
    winnerSchema,
    input,
  );
  const diff =
    winnerRounds !== undefined && loserRounds !== undefined ? winnerRounds - loserRounds : 0;
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: { status: true, game: true, mode: true, bracketRound: true },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  if (match.bracketRound === null || !isHeadToHead(match.mode))
    throw new AppError("VALIDATION", "Only two-team bracket games have a winner to pick.");
  if (match.status === "COMPLETED")
    throw new AppError("CONFLICT", "This game already has a winner.");
  if (!["REGISTRATION_CLOSED", "LIVE", "RESULTS_PENDING"].includes(match.status))
    throw new AppError("CONFLICT", "This game can't get a winner now.");
  const regs = await db.registration.findMany({
    where: { matchId, status: "CONFIRMED" },
    select: { id: true },
  });
  if (!regs.some((r) => r.id === winnerRegistrationId))
    throw new AppError("VALIDATION", "That team isn't in this game.");
  // Checked first, so a missing season can't leave the game half-way.
  const season = await db.season.findFirst({ where: { game: match.game, isActive: true } });
  if (!season)
    throw new AppError(
      "CONFLICT",
      "There is no active season for this game. Start one in Seasons first.",
    );

  if (match.status === "REGISTRATION_CLOSED")
    await transitionMatchStatus(me, { matchId, to: "LIVE" });
  if (match.status !== "RESULTS_PENDING")
    await transitionMatchStatus(me, { matchId, to: "RESULTS_PENDING" });
  await saveResultRows(me, {
    matchId,
    rows: regs.map((r) => ({
      registrationId: r.id,
      won: r.id === winnerRegistrationId,
      roundDiff: r.id === winnerRegistrationId ? diff : -diff,
    })),
  });
  const summary = await approveResults(me, { matchId });
  await db.match.update({
    where: { id: matchId },
    data: { roomId: null, roomPassword: null },
  });
  return summary;
}
