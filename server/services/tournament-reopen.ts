import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { assertAdmin, type Actor } from "@/lib/roles";
import { istInputToUtc } from "@/lib/time";
import { registrationWindowIssues } from "./tournaments";

const NOT_STARTED = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];

const reopenSchema = z.object({
  tournamentId: z.string().min(1).max(64),
  closesAt: z
    .string()
    .trim()
    .min(1, "Pick a closing time")
    .transform((v, ctx) => {
      const d = istInputToUtc(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Pick a valid date and time" });
        return z.NEVER;
      }
      return d;
    }),
});

/**
 * Why a closed tournament can't be reopened (null = it can). Only before any game has started: the
 * drawn bracket or lobbies are undone, nothing that was played.
 */
export async function reopenBlocker(reader: Tx | typeof db, tournamentId: string) {
  const t = await reader.tournament.findUnique({
    where: { id: tournamentId },
    select: { cancelledAt: true, winnersPublishedAt: true, entryMatchId: true },
  });
  if (!t || !t.entryMatchId) return "Tournament not found.";
  if (t.cancelledAt) return "This tournament is cancelled.";
  if (t.winnersPublishedAt) return "Winners are already published.";
  const entry = await reader.match.findUniqueOrThrow({
    where: { id: t.entryMatchId },
    select: { status: true },
  });
  if (entry.status !== "REGISTRATION_CLOSED") return "Registration is not closed.";
  const started = await reader.match.count({
    where: {
      tournamentId,
      isEntryList: false,
      OR: [{ status: { notIn: NOT_STARTED as never } }, { results: { some: {} } }],
    },
  });
  if (started) return "A game has already started, so registration can't be reopened.";
  return null;
}

/**
 * Admin (DECISIONS M61): registration closed by mistake → open it again until a new closing time.
 * The bracket or lobby split made at close is undone (its game rows and their room codes are
 * removed); every sign-up stays. Drawn again when it closes next time.
 */
export async function reopenRegistration(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertAdmin(actor);
  const { tournamentId, closesAt } = parseInput(reopenSchema, input);
  return db.$transaction(async (tx) => {
    const blocker = await reopenBlocker(tx, tournamentId);
    if (blocker) throw new AppError("CONFLICT", blocker);
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const issue = registrationWindowIssues(null, closesAt, t.startsAt, now)[0];
    if (issue) throw new AppError("VALIDATION", issue.message, { closesAt: [issue.message] });

    // Bracket games and extra lobbies only exist because registration closed: remove them.
    const { count: removedGames } = await tx.match.deleteMany({
      where: {
        tournamentId,
        isEntryList: false,
        OR: [{ bracketRound: { not: null } }, { parentMatchId: { not: null } }],
      },
    });
    // Lobby 1 is the admin's own round match: give it back its title and no players.
    const rounds = await tx.match.findMany({
      where: { tournamentId, isEntryList: false, lobbyNumber: { not: null } },
      select: { id: true, title: true },
    });
    for (const r of rounds) {
      await tx.registration.deleteMany({ where: { matchId: r.id } });
      await tx.match.update({
        where: { id: r.id },
        data: {
          lobbyNumber: null,
          title: r.title.replace(/ — Lobby 1$/, ""),
          roomId: null,
          roomPassword: null,
          roomNoticeSentAt: null,
        },
      });
    }
    // REGISTRATION_CLOSED → REGISTRATION_OPEN is not a normal transition; only this admin undo does it.
    await tx.match.update({
      where: { id: t.entryMatchId! },
      data: { status: "REGISTRATION_OPEN", registrationClosesAt: closesAt },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "tournament.reopenRegistration",
      entityType: "Tournament",
      entityId: tournamentId,
      before: { status: "REGISTRATION_CLOSED" },
      after: { status: "REGISTRATION_OPEN", closesAt, removedGames, resetRounds: rounds.length },
    });
    return { removedGames, resetRounds: rounds.length };
  });
}
