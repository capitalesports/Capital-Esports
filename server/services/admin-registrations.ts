import "server-only";
import { z } from "zod";
import type { RegistrationStatus } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { isEditable, type MatchStatus } from "@/lib/match-state";
import { assertCanManageMatch, assertModerator, type Actor } from "@/lib/roles";
import { notify, type NotificationEvent } from "./notify";
import { enterPendingPayment, executeRefunds, markRefund } from "./payments";
import { lockMatch, promoteWaitlist, SLOT_HOLDING } from "./registration";

/** Registrations that still take part (or wait) in a match. */
export const ACTIVE_REGISTRATION: RegistrationStatus[] = [
  "PENDING",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "WAITLISTED",
];

type Refund = NonNullable<Awaited<ReturnType<typeof markRefund>>>;

export interface DroppedRegistration {
  /** Registrant plus roster members of the dropped entry. */
  players: string[];
  refund: Refund | null;
  /** Players promoted from the waitlist into the freed slot. */
  promoted: string[];
}

/**
 * Inside a transaction that holds the match lock: cancel one registration, free its roster,
 * refund a paid entry and fill the freed slot from the waitlist (registration open or closed).
 */
export async function dropRegistration(
  tx: Tx,
  reg: { id: string; userId: string; status: RegistrationStatus; paymentId: string | null },
  match: { id: string; status: MatchStatus; maxSlots: number; entryFeePaise: number },
  refundReason: string,
): Promise<DroppedRegistration> {
  const roster = await tx.registrationMember.findMany({
    where: { registrationId: reg.id },
    select: { userId: true },
  });
  await tx.registration.update({
    where: { id: reg.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
  let refund: Refund | null = null;
  if (reg.paymentId) {
    await tx.payment.updateMany({
      where: { id: reg.paymentId, status: "CREATED" },
      data: { status: "FAILED" },
    });
    refund = await markRefund(tx, reg.paymentId, refundReason);
  }
  const canPromote = match.status === "REGISTRATION_OPEN" || match.status === "REGISTRATION_CLOSED";
  const promoted =
    canPromote && SLOT_HOLDING.includes(reg.status) ? await promoteWaitlist(tx, match) : [];
  return {
    players: [...new Set([reg.userId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))])],
    refund,
    promoted,
  };
}

/** The registrations table on /admin/matches/[id]: entries, rosters with game IDs, payments. */
export async function listMatchRegistrations(actor: Actor | null, matchId: string) {
  assertModerator(actor);
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: { id: true, game: true, status: true, maxSlots: true },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  const profile = { where: { game: match.game }, select: { gameId: true, ign: true } };
  const [regs, payments] = await Promise.all([
    db.registration.findMany({
      where: { matchId },
      orderBy: [{ position: "asc" }],
      include: {
        user: { select: { id: true, displayName: true, gameProfiles: profile } },
        team: { select: { id: true, name: true } },
        members: {
          include: { user: { select: { id: true, displayName: true, gameProfiles: profile } } },
        },
      },
    }),
    db.payment.findMany({
      where: { matchId },
      select: { id: true, status: true, amountPaise: true },
    }),
  ]);
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const player = (u: (typeof regs)[number]["user"], status: string) => ({
    userId: u.id,
    name: u.displayName ?? "Player",
    gameId: u.gameProfiles[0]?.gameId ?? null,
    ign: u.gameProfiles[0]?.ign ?? null,
    status,
  });
  const slotsTaken = regs.filter((r) => SLOT_HOLDING.includes(r.status)).length;
  return {
    match,
    freeSlots: Math.max(0, match.maxSlots - slotsTaken),
    rows: regs.map((r) => {
      const payment = r.paymentId ? paymentById.get(r.paymentId) : undefined;
      return {
        id: r.id,
        position: r.position,
        status: r.status,
        name: r.team?.name ?? r.teamName ?? r.user.displayName ?? "Player",
        teamId: r.team?.id ?? null,
        captain: { id: r.user.id, name: r.user.displayName ?? "Player" },
        roster: r.members.length
          ? r.members.map((m) => ({
              ...(m.user && !m.gameId
                ? player(m.user, m.status)
                : {
                    // Entered by the captain: the game ID and exact in-game name as typed.
                    userId: m.userId,
                    name: m.ign ?? m.user?.displayName ?? "Player",
                    gameId: m.gameId,
                    ign: m.ign,
                    status: m.status,
                  }),
              // The registering captain is the team's IGL (team leader).
              igl: r.members.length > 1 && m.userId === r.userId,
            }))
          : [{ ...player(r.user, "CONFIRMED"), igl: false }],
        payment: payment ? { status: payment.status, amountPaise: payment.amountPaise } : null,
        createdAt: r.createdAt,
      };
    }),
  };
}

async function loadRegistration(tx: Tx, registrationId: string) {
  const reg = await tx.registration.findUnique({ where: { id: registrationId } });
  if (!reg) throw new AppError("NOT_FOUND", "Registration not found.");
  return reg;
}

const removeSchema = z.object({
  registrationId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

/**
 * Remove an entry before the match starts: the registration is cancelled, a paid entry refunded,
 * and the next waitlisted entry promoted into the freed slot.
 */
export async function adminRemoveRegistration(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { registrationId, reason } = parseInput(removeSchema, input);
  const events: NotificationEvent[] = [];
  const dropped = await db.$transaction(async (tx) => {
    const { matchId } = await loadRegistration(tx, registrationId);
    const match = await lockMatch(tx, matchId);
    assertCanManageMatch(actor, match);
    // Once lobbies or the bracket are drawn from a sign-up list, removing an entry there would leave
    // its copies playing (or reshuffle the bracket): handle it in the lobby/bracket match instead.
    if (match.isEntryList && match.status !== "REGISTRATION_OPEN" && match.status !== "UPCOMING") {
      throw new AppError(
        "CONFLICT",
        "Registration has closed and lobbies/bracket are drawn. Remove the entry from its match instead.",
      );
    }
    const reg = await loadRegistration(tx, registrationId);
    if (!ACTIVE_REGISTRATION.includes(reg.status))
      throw new AppError("CONFLICT", "This entry is already cancelled.");
    if (!isEditable(match.status))
      throw new AppError("CONFLICT", "Entries can only be removed before the match starts.");
    const result = await dropRegistration(tx, reg, match, `Removed by a moderator: ${reason}`);
    await writeAudit(tx, {
      actorId: me.id,
      action: "registration.remove",
      entityType: "Registration",
      entityId: reg.id,
      before: { status: reg.status, matchId, userId: reg.userId, teamId: reg.teamId },
      after: {
        status: "CANCELLED",
        reason,
        refund: result.refund ? result.refund.id : null,
        promoted: result.promoted,
      },
    });
    events.push({ type: "REGISTRATION_REMOVED", userIds: result.players, matchId, reason });
    if (result.promoted.length)
      events.push({ type: "WAITLIST_PROMOTED", userIds: result.promoted, matchId });
    return result;
  });
  if (dropped.refund) await executeRefunds([dropped.refund]);
  await Promise.all(events.map(notify));
  return { refunded: !!dropped.refund, promoted: dropped.promoted.length };
}

/** Move a specific waitlisted entry into a free slot (paid matches: it gets the payment window). */
export async function adminPromoteRegistration(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { registrationId } = parseInput(z.object({ registrationId: z.string().min(1) }), input);
  const result = await db.$transaction(async (tx) => {
    const { matchId } = await loadRegistration(tx, registrationId);
    const match = await lockMatch(tx, matchId);
    assertCanManageMatch(actor, match);
    const reg = await loadRegistration(tx, registrationId);
    if (reg.status !== "WAITLISTED")
      throw new AppError("CONFLICT", "Only waitlisted entries can be promoted.");
    if (match.status !== "REGISTRATION_OPEN" && match.status !== "REGISTRATION_CLOSED")
      throw new AppError("CONFLICT", "Entries can only be promoted before the match starts.");
    const taken = await tx.registration.count({
      where: { matchId, status: { in: SLOT_HOLDING } },
    });
    if (taken >= match.maxSlots) throw new AppError("CONFLICT", "There is no free slot.");
    const status = match.entryFeePaise > 0 ? "PENDING_PAYMENT" : "CONFIRMED";
    if (status === "PENDING_PAYMENT") await enterPendingPayment(tx, reg, match);
    else await tx.registration.update({ where: { id: reg.id }, data: { status } });
    const roster = await tx.registrationMember.findMany({
      where: { registrationId: reg.id },
      select: { userId: true },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "registration.promote",
      entityType: "Registration",
      entityId: reg.id,
      before: { status: reg.status, matchId },
      after: { status },
    });
    return {
      matchId,
      status,
      players: [reg.userId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))],
    };
  });
  await notify({ type: "WAITLIST_PROMOTED", userIds: result.players, matchId: result.matchId });
  return result.status;
}
