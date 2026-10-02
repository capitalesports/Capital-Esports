import "server-only";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { isOpenEntry, lobbyWord, planLobbies } from "@/lib/lobbies";
import { executeRefunds, markRefund } from "./payments";
import { notify, type NotificationEvent } from "./notify";

/** Registrations that go into a lobby (a pending payment still has its place). */
const PLACED = ["CONFIRMED", "PENDING_PAYMENT"] as const;

export interface LobbySplit {
  /** Notifications to send after commit. */
  events: NotificationEvent[];
  lobbies: number;
}

async function playersOf(tx: Tx, reg: { id: string; userId: string }) {
  const roster = await tx.registrationMember.findMany({
    where: { registrationId: reg.id },
    select: { userId: true },
  });
  // Roster players entered by game ID without an account can't be notified: skip them.
  return [...new Set([reg.userId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))])];
}

/**
 * Inside the registration-close transaction: an open-entry scrim with more entries than one lobby
 * holds is split into balanced lobbies (head-to-head: games of 2 sides). The listing becomes lobby 1
 * and keeps the first entries in sign-up order; each extra lobby is its own match (room, results,
 * prize) pointing back at it. A head-to-head side left without an opponent stays on the listing's
 * waitlist for an admin to place or refund. Idempotent: a listing is split once.
 */
export async function splitIntoLobbies(
  tx: Tx,
  matchId: string,
  actorId: string | null,
): Promise<LobbySplit | null> {
  const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
  if (!isOpenEntry(match) || match.lobbyNumber !== null) return null;
  const entries = await tx.registration.findMany({
    where: { matchId, status: { in: [...PLACED] } },
    orderBy: { position: "asc" },
  });
  const plan = planLobbies(entries.length, match.maxSlots, match.mode);
  if (plan.sizes.length <= 1 && plan.unplaced === 0) return null;

  const word = lobbyWord(match.mode);
  const events: NotificationEvent[] = [];
  await tx.match.update({ where: { id: matchId }, data: { lobbyNumber: 1 } });

  let next = 0;
  for (const [i, size] of plan.sizes.entries()) {
    const group = entries.slice(next, next + size);
    next += size;
    let lobbyId = matchId;
    if (i > 0) {
      const lobby = await tx.match.create({
        data: {
          game: match.game,
          kind: match.kind,
          mode: match.mode,
          title: `${match.title} — ${word} ${i + 1}`,
          description: match.description,
          startsAt: match.startsAt,
          registrationOpensAt: match.registrationOpensAt,
          registrationClosesAt: match.registrationClosesAt,
          maxSlots: match.maxSlots,
          // Already filled from the listing: never auto-cancelled for being short.
          minSlots: 0,
          entryFeePaise: match.entryFeePaise,
          prizePaise: match.prizePaise,
          status: "REGISTRATION_CLOSED",
          streamUrl: match.streamUrl,
          parentMatchId: matchId,
          lobbyNumber: i + 1,
          createdById: match.createdById,
        },
      });
      lobbyId = lobby.id;
    }
    for (const [pos, reg] of group.entries()) {
      if (lobbyId !== matchId) {
        await tx.registrationMember.updateMany({
          where: { registrationId: reg.id },
          data: { matchId: lobbyId },
        });
        await tx.payment.updateMany({ where: { registrationId: reg.id }, data: { matchId: lobbyId } });
      }
      await tx.registration.update({
        where: { id: reg.id },
        data: { matchId: lobbyId, position: pos + 1 },
      });
      events.push({
        type: "LOBBY_ASSIGNED",
        userIds: await playersOf(tx, reg),
        matchId: lobbyId,
        lobby: `${word} ${i + 1}`,
      });
    }
  }
  // The odd side out (head-to-head only): waits on the listing for an admin decision.
  const unplaced = entries.slice(next);
  for (const reg of unplaced) {
    await tx.registration.update({ where: { id: reg.id }, data: { status: "WAITLISTED" } });
    events.push({ type: "LOBBY_UNPLACED", userIds: await playersOf(tx, reg), matchId });
  }
  await writeAudit(tx, {
    actorId,
    action: "match.lobbies.split",
    entityType: "Match",
    entityId: matchId,
    after: { entries: entries.length, lobbies: plan.sizes, unplaced: unplaced.length },
  });
  return { events: mergeByMatch(events), lobbies: plan.sizes.length };
}

/** One notification per lobby instead of one per registration. */
function mergeByMatch(events: NotificationEvent[]): NotificationEvent[] {
  const out = new Map<string, NotificationEvent>();
  for (const e of events) {
    const key = `${e.type}:${"matchId" in e ? e.matchId : ""}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, userIds: [...prev.userIds, ...e.userIds] } : e);
  }
  return [...out.values()];
}

export async function sendLobbyNotices(split: LobbySplit | null) {
  if (split) await Promise.all(split.events.map(notify));
}

/**
 * When a split listing goes live, sides nobody placed can no longer play: their entry is cancelled
 * and any fee refunded. Safe to call more than once.
 */
export async function releaseUnplaced(matchId: string) {
  const outcome = await db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      select: { lobbyNumber: true, parentMatchId: true },
    });
    if (!match || match.lobbyNumber !== 1 || match.parentMatchId !== null) return null;
    const waiting = await tx.registration.findMany({ where: { matchId, status: "WAITLISTED" } });
    if (!waiting.length) return null;
    const refunds = [];
    const userIds: string[] = [];
    for (const reg of waiting) {
      userIds.push(...(await playersOf(tx, reg)));
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
      const refund = reg.paymentId
        ? await markRefund(tx, reg.paymentId, "No opponent was available")
        : null;
      if (refund) refunds.push(refund);
    }
    await writeAudit(tx, {
      actorId: null,
      action: "match.lobbies.releaseUnplaced",
      entityType: "Match",
      entityId: matchId,
      after: { registrations: waiting.map((r) => r.id) },
    });
    return { refunds, userIds };
  });
  if (!outcome) return;
  await executeRefunds(outcome.refunds);
  await notify({
    type: "REGISTRATION_REMOVED",
    userIds: outcome.userIds,
    matchId,
    reason: "no opponent was available",
  });
}
