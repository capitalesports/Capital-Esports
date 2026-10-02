import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { GAMES } from "@/lib/games";
import type { MatchStatus } from "@/lib/match-state";
import { assertAdmin, type Actor } from "@/lib/roles";
import { istInputToUtc } from "@/lib/time";
import { dateOfBirthSchema } from "@/lib/validators";
import {
  ACTIVE_REGISTRATION,
  dropRegistration,
  type DroppedRegistration,
} from "./admin-registrations";
import { refreshLeaderboard } from "./leaderboard";
import { notify, type NotificationEvent } from "./notify";
import { executeRefunds } from "./payments";
import { lockMatch } from "./registration";

const userSummarySelect = {
  id: true,
  phone: true,
  email: true,
  displayName: true,
  role: true,
  strikes: true,
  bannedAt: true,
  bannedUntil: true,
  deletedAt: true,
  createdAt: true,
  gameProfiles: { select: { game: true, gameId: true, ign: true } },
} satisfies Prisma.UserSelect;

/** Search by phone digits, email, display name or any game ID. */
export async function searchUsers(actor: Actor | null, rawQuery: string, take = 50) {
  assertAdmin(actor);
  const q = rawQuery.trim().slice(0, 64);
  if (!q) {
    return db.user.findMany({ select: userSummarySelect, orderBy: { createdAt: "desc" }, take });
  }
  const digits = q.replace(/\D/g, "");
  const or: Prisma.UserWhereInput[] = [
    { displayName: { contains: q, mode: "insensitive" } },
    // Players who signed up with Google may have no phone (DECISIONS M31).
    { email: { contains: q.toLowerCase(), mode: "insensitive" } },
    { gameProfiles: { some: { gameId: { contains: q.toLowerCase(), mode: "insensitive" } } } },
    { gameProfiles: { some: { ign: { contains: q, mode: "insensitive" } } } },
  ];
  if (digits.length >= 4) or.push({ phone: { contains: digits } });
  return db.user.findMany({
    where: { OR: or },
    select: userSummarySelect,
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getUserDetail(actor: Actor | null, userId: string) {
  assertAdmin(actor);
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      gameProfiles: true,
      teamMemberships: {
        include: { team: { select: { id: true, name: true, game: true, captainId: true } } },
      },
      registrations: {
        include: {
          match: { select: { id: true, title: true, game: true, startsAt: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "User not found.");
  const [points, audit] = await Promise.all([
    db.pointsEntry.groupBy({ by: ["seasonId"], where: { userId }, _sum: { points: true } }),
    db.auditLog.findMany({
      where: { OR: [{ entityType: "User", entityId: userId }, { actorId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { displayName: true, phone: true } } },
    }),
  ]);
  return { user, points, audit };
}

const banSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(300),
  /** IST datetime-local; empty = permanent */
  until: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = istInputToUtc(v);
      if (!d || d <= new Date()) {
        ctx.addIssue({ code: "custom", message: "Pick a future end date or leave empty" });
        return z.NEVER;
      }
      return d;
    }),
});

async function loadTarget(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: { gameProfiles: true } });
  if (!user) throw new AppError("NOT_FOUND", "User not found.");
  return user;
}

const NOT_STARTED: MatchStatus[] = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"];

/**
 * Cancel every registration the user holds (solo entries and teams they captain) in matches that
 * have not started: paid entries are refunded and waitlists promoted.
 */
async function dropUpcomingRegistrations(tx: Tx, userId: string, reason: string) {
  const regs = await tx.registration.findMany({
    where: {
      userId,
      status: { in: ACTIVE_REGISTRATION },
      match: { status: { in: NOT_STARTED } },
    },
    select: { id: true, matchId: true },
    orderBy: { matchId: "asc" },
  });
  const refunds: NonNullable<DroppedRegistration["refund"]>[] = [];
  const events: NotificationEvent[] = [];
  const cancelled: string[] = [];
  for (const r of regs) {
    const match = await lockMatch(tx, r.matchId);
    const reg = await tx.registration.findUniqueOrThrow({ where: { id: r.id } });
    if (!ACTIVE_REGISTRATION.includes(reg.status) || !NOT_STARTED.includes(match.status)) continue;
    const dropped = await dropRegistration(tx, reg, match, reason);
    cancelled.push(reg.id);
    if (dropped.refund) refunds.push(dropped.refund);
    if (dropped.promoted.length)
      events.push({ type: "WAITLIST_PROMOTED", userIds: dropped.promoted, matchId: r.matchId });
  }
  return { cancelled, refunds, events };
}

/** Rebuild the active-season leaderboards where any of these users has points. */
async function refreshSeasonsOf(tx: Tx, userIds: string[]) {
  const seasons = await tx.season.findMany({
    where: { isActive: true, pointsEntries: { some: { userId: { in: userIds } } } },
    select: { id: true },
  });
  for (const s of seasons) await refreshLeaderboard(tx, s.id);
  return seasons.map((s) => s.id);
}

/**
 * Ban the account and add its phone and every game ID to the ban list. Their upcoming
 * registrations are cancelled (refunded) and they leave the active leaderboards.
 */
export async function banUser(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { userId, reason, until } = parseInput(banSchema, input);
  if (userId === me.id) throw new AppError("VALIDATION", "You cannot ban yourself.");
  const dropped = await db.$transaction(async (tx) => {
    const user = await loadTarget(tx, userId);
    const now = new Date();
    await tx.user.update({
      where: { id: userId },
      data: { bannedAt: now, bannedUntil: until, banReason: reason },
    });
    await tx.ban.createMany({
      data: [
        // Phone and email bans: a banned player can't come back by phone OTP or Google (M31).
        ...(user.phone ? [{ phone: user.phone, reason, expiresAt: until, createdById: me.id }] : []),
        ...(user.email ? [{ email: user.email, reason, expiresAt: until, createdById: me.id }] : []),
        ...user.gameProfiles.map((p) => ({
          game: p.game,
          gameId: p.gameId,
          reason,
          expiresAt: until,
          createdById: me.id,
        })),
      ],
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.ban",
      entityType: "User",
      entityId: userId,
      before: { bannedAt: user.bannedAt, bannedUntil: user.bannedUntil, banReason: user.banReason },
      after: {
        bannedAt: now,
        bannedUntil: until,
        banReason: reason,
        gameIds: user.gameProfiles.map((p) => `${p.game}:${p.gameId}`),
      },
    });
    const drop = await dropUpcomingRegistrations(tx, userId, "Player banned");
    const seasons = await refreshSeasonsOf(tx, [userId]);
    if (drop.cancelled.length || seasons.length) {
      await writeAudit(tx, {
        actorId: me.id,
        action: "user.ban.cleanup",
        entityType: "User",
        entityId: userId,
        after: {
          cancelledRegistrations: drop.cancelled,
          refunds: drop.refunds.length,
          refreshedSeasons: seasons,
        },
      });
    }
    return drop;
  });
  await executeRefunds(dropped.refunds);
  await Promise.all(dropped.events.map(notify));
  return { cancelledRegistrations: dropped.cancelled.length, refunds: dropped.refunds.length };
}

export async function unbanUser(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { userId } = parseInput(z.object({ userId: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const user = await loadTarget(tx, userId);
    const now = new Date();
    await tx.user.update({
      where: { id: userId },
      data: { bannedAt: null, bannedUntil: null, banReason: null },
    });
    // Only this player's records. A missing phone/email must not become `null`, which would match
    // (and lift) every other player's game-ID bans.
    const own = [
      ...(user.phone ? [{ phone: user.phone }] : []),
      ...(user.email ? [{ email: user.email }] : []),
      ...user.gameProfiles.map((p) => ({ game: p.game, gameId: p.gameId })),
    ];
    if (own.length) {
      await tx.ban.updateMany({ where: { liftedAt: null, OR: own }, data: { liftedAt: now } });
    }
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.unban",
      entityType: "User",
      entityId: userId,
      before: { bannedAt: user.bannedAt, bannedUntil: user.bannedUntil, banReason: user.banReason },
      after: { bannedAt: null },
    });
    // Back on the leaderboards with the points they already had.
    await refreshSeasonsOf(tx, [userId]);
  });
}

/** Remove a player's ID for one game (e.g. a typo) so they can enter it again. */
export async function resetGameProfile(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { userId, game } = parseInput(
    z.object({ userId: z.string().min(1), game: z.enum(GAMES) }),
    input,
  );
  await db.$transaction(async (tx) => {
    const profile = await tx.gameProfile.findUnique({ where: { userId_game: { userId, game } } });
    if (!profile) throw new AppError("NOT_FOUND", "This user has no profile for that game.");
    await tx.gameProfile.delete({ where: { id: profile.id } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.resetGameProfile",
      entityType: "User",
      entityId: userId,
      before: profile,
    });
  });
}

/** Support corrects a player's date of birth (players can't change it once saved, DECISIONS M19). */
export async function setUserDateOfBirth(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { userId, dateOfBirth } = parseInput(
    z.object({ userId: z.string().min(1), dateOfBirth: dateOfBirthSchema }),
    input,
  );
  await db.$transaction(async (tx) => {
    const user = await loadTarget(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { dateOfBirth } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.setDateOfBirth",
      entityType: "User",
      entityId: userId,
      before: { dateOfBirth: user.dateOfBirth },
      after: { dateOfBirth },
    });
  });
}

const ROLES = ["PLAYER", "MODERATOR", "ADMIN"] as const;

export async function setUserRole(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { userId, role } = parseInput(
    z.object({ userId: z.string().min(1), role: z.enum(ROLES) }),
    input,
  );
  if (userId === me.id) throw new AppError("VALIDATION", "You cannot change your own role.");
  await db.$transaction(async (tx) => {
    const user = await loadTarget(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { role } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.role",
      entityType: "User",
      entityId: userId,
      before: { role: user.role },
      after: { role },
    });
  });
}

const mergeSchema = z
  .object({ primaryId: z.string().min(1), duplicateId: z.string().min(1) })
  .refine((v) => v.primaryId !== v.duplicateId, "Pick two different accounts");

/**
 * Merge a duplicate account into a primary one: move registrations, roster entries, points,
 * team memberships/captaincies and game IDs the primary lacks; add strikes; soft-delete the duplicate.
 * Rows that would collide (same match/team) stay with the soft-deleted duplicate.
 */
export async function mergeUsers(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { primaryId, duplicateId } = parseInput(mergeSchema, input);
  return db.$transaction(async (tx) => {
    const primary = await loadTarget(tx, primaryId);
    const dup = await loadTarget(tx, duplicateId);
    if (primary.deletedAt || dup.deletedAt)
      throw new AppError("CONFLICT", "One of these accounts is already merged.");

    const moved = {
      registrations: 0,
      roster: 0,
      points: 0,
      teams: 0,
      gameProfiles: 0,
      payouts: 0,
      payoutMethod: false,
      refreshedSeasons: [] as string[],
    };

    const primaryMatchIds = new Set(
      (
        await tx.registration.findMany({ where: { userId: primaryId }, select: { matchId: true } })
      ).map((r) => r.matchId),
    );
    for (const r of await tx.registration.findMany({ where: { userId: duplicateId } })) {
      if (primaryMatchIds.has(r.matchId)) continue;
      await tx.registration.update({ where: { id: r.id }, data: { userId: primaryId } });
      moved.registrations++;
    }

    const primaryRoster = new Set(
      (
        await tx.registrationMember.findMany({
          where: { userId: primaryId },
          select: { matchId: true },
        })
      ).map((r) => r.matchId),
    );
    for (const m of await tx.registrationMember.findMany({ where: { userId: duplicateId } })) {
      if (primaryRoster.has(m.matchId)) continue;
      await tx.registrationMember.update({ where: { id: m.id }, data: { userId: primaryId } });
      moved.roster++;
    }

    const primaryPointMatches = new Set(
      (
        await tx.pointsEntry.findMany({ where: { userId: primaryId }, select: { matchId: true } })
      ).map((p) => p.matchId),
    );
    for (const p of await tx.pointsEntry.findMany({ where: { userId: duplicateId } })) {
      if (primaryPointMatches.has(p.matchId)) continue;
      await tx.pointsEntry.update({ where: { id: p.id }, data: { userId: primaryId } });
      moved.points++;
    }

    const primaryTeams = new Set(
      (
        await tx.teamMember.findMany({
          where: { userId: primaryId },
          select: { teamId: true, game: true },
        })
      ).map((t) => t.game),
    );
    for (const t of await tx.teamMember.findMany({ where: { userId: duplicateId } })) {
      if (primaryTeams.has(t.game)) continue;
      await tx.teamMember.update({ where: { id: t.id }, data: { userId: primaryId } });
      await tx.team.updateMany({
        where: { id: t.teamId, captainId: duplicateId },
        data: { captainId: primaryId },
      });
      moved.teams++;
    }

    const primaryGames = new Set(primary.gameProfiles.map((p) => p.game));
    for (const p of dup.gameProfiles) {
      if (primaryGames.has(p.game)) continue;
      await tx.gameProfile.update({ where: { id: p.id }, data: { userId: primaryId } });
      moved.gameProfiles++;
    }

    // Prizes follow the player; a prize the primary already has for the same source stays behind.
    const primaryPayouts = await tx.payout.findMany({
      where: { userId: primaryId },
      select: { tournamentId: true, seasonId: true, matchId: true },
    });
    const taken = (key: "tournamentId" | "seasonId" | "matchId", v: string | null) =>
      v !== null && primaryPayouts.some((p) => p[key] === v);
    for (const p of await tx.payout.findMany({ where: { userId: duplicateId } })) {
      if (taken("tournamentId", p.tournamentId) || taken("seasonId", p.seasonId)) continue;
      if (taken("matchId", p.matchId)) continue;
      await tx.payout.update({ where: { id: p.id }, data: { userId: primaryId } });
      moved.payouts++;
    }
    const methods = await tx.payoutMethod.findMany({
      where: { userId: { in: [primaryId, duplicateId] } },
      select: { id: true, userId: true },
    });
    const dupMethod = methods.find((m) => m.userId === duplicateId);
    if (dupMethod && !methods.some((m) => m.userId === primaryId)) {
      await tx.payoutMethod.update({ where: { id: dupMethod.id }, data: { userId: primaryId } });
      moved.payoutMethod = true;
    }

    await tx.user.update({
      where: { id: primaryId },
      data: { strikes: { increment: dup.strikes } },
    });
    await tx.user.update({
      where: { id: duplicateId },
      data: { deletedAt: new Date(), mergedIntoId: primaryId },
    });
    moved.refreshedSeasons = await refreshSeasonsOf(tx, [primaryId, duplicateId]);
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.merge",
      entityType: "User",
      entityId: primaryId,
      before: { duplicateId, duplicatePhone: dup.phone },
      after: moved,
    });
    return moved;
  });
}
