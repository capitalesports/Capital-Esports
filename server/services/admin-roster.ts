import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { isBanRecordActive, isRegistrationBlocked } from "@/lib/bans";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { isEditable } from "@/lib/match-state";
import { assertCanManageMatch, assertModerator, type Actor } from "@/lib/roles";
import { gameProfileRecord, gameProfileSchema } from "@/lib/validators";
import { ACTIVE_REGISTRATION } from "./admin-registrations";
import { lockMatch } from "./registration";

const editSchema = z.object({
  memberId: z.string().min(1),
  gameId: z.string().max(40),
  ign: z.string().max(40).optional(),
});

type Member = { id: string; matchId: string; registrationId: string };

/** The account that owns this game ID and in-game name (same rule as captain-entered rosters). */
async function linkedOwner(tx: Tx, game: Game, gameId: string, ign: string, now: Date) {
  const owner = await tx.gameProfile.findUnique({
    where: { game_gameId: { game, gameId } },
    select: {
      ign: true,
      userId: true,
      user: {
        select: {
          bannedAt: true,
          bannedUntil: true,
          registrationBlockedUntil: true,
          deletedAt: true,
        },
      },
    },
  });
  if (!owner || owner.user.deletedAt) return null;
  if (owner.ign?.trim().toLowerCase() !== ign.trim().toLowerCase()) return null;
  if (isRegistrationBlocked(owner.user, now)) {
    throw new AppError("FORBIDDEN", `${ign} is blocked from registering right now.`);
  }
  return owner.userId;
}

/** Nobody else in this match (any active entry) may already play with this ID or account. */
async function assertFreeInMatch(
  tx: Tx,
  member: Member,
  gameId: string,
  userId: string | null,
  ign: string,
) {
  const active = { status: { in: ACTIVE_REGISTRATION } };
  const [byId, byUser, asRegistrant] = await Promise.all([
    tx.registrationMember.findFirst({
      where: { matchId: member.matchId, gameId, id: { not: member.id }, registration: active },
      select: { id: true },
    }),
    userId
      ? tx.registrationMember.findFirst({
          where: { matchId: member.matchId, userId, id: { not: member.id }, registration: active },
          select: { id: true },
        })
      : null,
    userId
      ? tx.registration.findFirst({
          where: {
            matchId: member.matchId,
            userId,
            id: { not: member.registrationId },
            ...active,
          },
          select: { id: true },
        })
      : null,
  ]);
  if (byId || byUser || asRegistrant) {
    throw new AppError("CONFLICT", `Already playing in this match: ${ign}.`);
  }
}

/**
 * Staff fix for a captain-entered roster (wrong or duplicated player) before the match starts:
 * replace one player's game ID and in-game name. The account with that ID and name is linked as
 * at registration. In a tournament, the same player is also replaced on the sign-up list, which
 * later rounds copy from.
 */
export async function adminEditRosterPlayer(actor: Actor | null, input: unknown, now = new Date()) {
  assertModerator(actor);
  const { memberId, ...raw } = parseInput(editSchema, input);
  return db.$transaction(async (tx) => {
    const found = await tx.registrationMember.findUnique({
      where: { id: memberId },
      select: { matchId: true },
    });
    if (!found) throw new AppError("NOT_FOUND", "Player not found.");
    const match = await lockMatch(tx, found.matchId);
    const me = assertCanManageMatch(actor, match);
    const member = await tx.registrationMember.findUnique({
      where: { id: memberId },
      include: { registration: { select: { id: true, userId: true, status: true } } },
    });
    if (!member) throw new AppError("NOT_FOUND", "Player not found.");
    if (!isEditable(match.status))
      throw new AppError("CONFLICT", "Rosters can only be changed before the match starts.");
    if (!ACTIVE_REGISTRATION.includes(member.registration.status))
      throw new AppError("CONFLICT", "This entry is cancelled.");

    const parsed = gameProfileSchema.safeParse({ game: match.game, ...raw, region: "AP" });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Check the ID and name";
      throw new AppError("VALIDATION", message, { gameId: [message] });
    }
    const record = gameProfileRecord(parsed.data);
    const gameId = record.gameId;
    const ign = record.ign ?? record.gameId;

    const label = GAME_CONFIG[match.game].idLabel;
    const bans = await tx.ban.findMany({
      where: { game: match.game, gameId },
      select: { expiresAt: true, liftedAt: true },
    });
    if (bans.some((b) => isBanRecordActive(b, now)))
      throw new AppError("FORBIDDEN", `${ign} (${label} ${gameId}) is banned.`);

    const userId = await linkedOwner(tx, match.game, gameId, ign, now);
    await assertFreeInMatch(tx, member, gameId, userId, ign);

    const before = { gameId: member.gameId, ign: member.ign, userId: member.userId };
    const after = { gameId, ign, userId };
    await tx.registrationMember.update({ where: { id: member.id }, data: after });

    // Tournament rounds are copied from the sign-up list: fix the same player there too.
    let entryListMemberId: string | null = null;
    if (match.tournamentId && !match.isEntryList) {
      const t = await tx.tournament.findUnique({
        where: { id: match.tournamentId },
        select: { entryMatchId: true },
      });
      const source = t?.entryMatchId
        ? await tx.registrationMember.findFirst({
            where: {
              matchId: t.entryMatchId,
              registration: { userId: member.registration.userId, status: "CONFIRMED" },
              ...(member.gameId ? { gameId: member.gameId } : { userId: member.userId }),
            },
            select: { id: true, matchId: true, registrationId: true },
          })
        : null;
      if (source) {
        await assertFreeInMatch(tx, source, gameId, userId, ign);
        await tx.registrationMember.update({ where: { id: source.id }, data: after });
        entryListMemberId = source.id;
      }
    }

    await writeAudit(tx, {
      actorId: me.id,
      action: "registration.roster_edit",
      entityType: "Registration",
      entityId: member.registrationId,
      before: { matchId: match.id, memberId: member.id, ...before },
      after: { ...after, entryListMemberId },
    });
    return after;
  });
}
