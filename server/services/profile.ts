import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { getOtpVerifier } from "@/server/auth/otp-verifier";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/providers/storage";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { isBanRecordActive } from "@/lib/bans";
import { GAME_CONFIG } from "@/lib/games";
import { AVATAR_MAX_BYTES, checkImage, IMAGE_EXTENSION } from "@/lib/image";
import { canCancelRegistration } from "@/lib/registration-rules";
import { assertUser, type Actor } from "@/lib/roles";
import { isProfileComplete } from "@/lib/profile";
import { gameProfileRecord, gameProfileSchema, profileSchema } from "@/lib/validators";
import { trackOnce } from "./analytics";
import { executeRefunds, markRefund } from "./payments";
import { lockMatch, promoteWaitlist } from "./registration";
import { notify, type NotificationEvent } from "./notify";

async function trackIfComplete(userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: { gameProfiles: { select: { game: true } } },
  });
  if (u && isProfileComplete(u)) await trackOnce("PROFILE_COMPLETE", userId);
}

export async function updateProfile(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const data = parseInput(profileSchema, input);
  // The date of birth is set once (age and prize rules depend on it): only support can change it.
  const current = await db.user.findUniqueOrThrow({
    where: { id: me.id },
    select: { dateOfBirth: true },
  });
  if (
    current.dateOfBirth &&
    current.dateOfBirth.toISOString().slice(0, 10) !== data.dateOfBirth.toISOString().slice(0, 10)
  ) {
    throw new AppError("CONFLICT", "Your date of birth is locked. Contact support to change it.", {
      dateOfBirth: ["Locked: contact support to change it"],
    });
  }
  const saved = await db.user.update({
    where: { id: me.id },
    data: { displayName: data.displayName, dateOfBirth: data.dateOfBirth },
    select: { id: true, displayName: true, dateOfBirth: true },
  });
  await trackIfComplete(me.id);
  return saved;
}

export async function updateAvatar(actor: Actor | null, bytes: Uint8Array): Promise<string> {
  const me = assertUser(actor);
  const check = checkImage(bytes, AVATAR_MAX_BYTES);
  if (!check.ok) throw new AppError("VALIDATION", check.error, { avatar: [check.error] });
  const key = `avatars/${me.id}/${randomUUID()}.${IMAGE_EXTENSION[check.mime]}`;
  const url = await getStorage().put(key, bytes, check.mime);
  await db.user.update({ where: { id: me.id }, data: { avatarUrl: url } });
  return url;
}

/** Add or change the caller's ID for one game. Game IDs are unique across accounts. */
export async function saveGameProfile(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const record = gameProfileRecord(parseInput(gameProfileSchema, input));
  const label = GAME_CONFIG[record.game].idLabel;

  const bans = await db.ban.findMany({
    where: { game: record.game, gameId: record.gameId },
    select: { expiresAt: true, liftedAt: true },
  });
  if (bans.some((b) => isBanRecordActive(b))) {
    throw new AppError("BANNED", `This ${label} is banned and cannot be registered.`, {
      gameId: [`This ${label} is banned.`],
    });
  }

  try {
    const saved = await db.$transaction(async (tx) => {
      const before = await tx.gameProfile.findUnique({
        where: { userId_game: { userId: me.id, game: record.game } },
      });
      const saved = await tx.gameProfile.upsert({
        where: { userId_game: { userId: me.id, game: record.game } },
        create: { userId: me.id, ...record },
        update: { gameId: record.gameId, ign: record.ign, region: record.region },
      });
      if (before?.gameId !== saved.gameId || before?.ign !== saved.ign) {
        await writeAudit(tx, {
          actorId: me.id,
          action: before ? "gameProfile.update" : "gameProfile.create",
          entityType: "GameProfile",
          entityId: saved.id,
          before,
          after: saved,
        });
      }
      return saved;
    });
    await trackIfComplete(me.id);
    return saved;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const msg = `This ${label} is already linked to another account.`;
      throw new AppError("CONFLICT", msg, { gameId: [msg] });
    }
    throw e;
  }
}

const ACTIVE_REG = ["PENDING", "PENDING_PAYMENT", "CONFIRMED", "WAITLISTED"] as const;
const UNFINISHED_MATCH = ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] as const;

/**
 * Erase an account (soft delete) once an admin approves the player's deletion request
 * (DECISIONS M39; players can't delete directly). Refused while the player captains a team or has
 * a payout in flight, or is in a match that can no longer be cancelled. Upcoming registrations are
 * cancelled (paid entries refunded), personal data, the Google link and the password are cleared,
 * and the phone stays reserved (bans/strikes). Callers check the admin role.
 */
export async function eraseAccount(userId: string, approvedById: string, now = new Date()) {
  const me = { id: userId };

  const captain = await db.team.findFirst({ where: { captainId: me.id }, select: { name: true } });
  if (captain) {
    throw new AppError(
      "CONFLICT",
      `The player captains ${captain.name}. They must make someone else captain or disband the team first.`,
    );
  }
  const inFlight = await db.payout.count({
    where: { userId: me.id, status: { in: ["PENDING", "PROCESSING"] }, voidedAt: null },
  });
  if (inFlight) {
    throw new AppError(
      "CONFLICT",
      "The player has a prize payout in progress. Approve the deletion once it is paid.",
    );
  }

  const ownRegs = await db.registration.findMany({
    where: { userId: me.id, status: { in: [...ACTIVE_REG] }, match: { status: { in: [...UNFINISHED_MATCH] } } },
    select: { id: true, matchId: true, match: { select: { status: true, registrationClosesAt: true } } },
  });
  const rosterSpots = await db.registrationMember.count({
    where: {
      userId: me.id,
      registration: { userId: { not: me.id }, status: { in: [...ACTIVE_REG] } },
      match: { status: { in: [...UNFINISHED_MATCH] } },
    },
  });
  // Deletion follows the registration window only: paid entries are refunded below (M39).
  if (rosterSpots || ownRegs.some((r) => !canCancelRegistration({ ...r.match, entryFeePaise: 0 }, now))) {
    throw new AppError(
      "CONFLICT",
      "The player is in a match that can no longer be cancelled (or on a team roster). Approve after it ends.",
    );
  }

  const events: NotificationEvent[] = [];
  const refunds: NonNullable<Awaited<ReturnType<typeof markRefund>>>[] = [];
  await db.$transaction(async (tx) => {
    for (const r of ownRegs) {
      const match = await lockMatch(tx, r.matchId);
      const reg = await tx.registration.findUniqueOrThrow({ where: { id: r.id } });
      if (!(ACTIVE_REG as readonly string[]).includes(reg.status)) continue;
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
      if (reg.paymentId) {
        await tx.payment.updateMany({
          where: { id: reg.paymentId, status: "CREATED" },
          data: { status: "FAILED" },
        });
        const refund = await markRefund(tx, reg.paymentId, "Account deleted");
        if (refund) refunds.push(refund);
      }
      if (reg.status === "CONFIRMED" || reg.status === "PENDING_PAYMENT") {
        const promoted = await promoteWaitlist(tx, match);
        if (promoted.length) events.push({ type: "WAITLIST_PROMOTED", userIds: promoted, matchId: match.id });
      }
    }
    const before = await tx.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { displayName: true, avatarUrl: true, dateOfBirth: true },
    });
    const games = await tx.gameProfile.findMany({
      where: { userId: me.id },
      select: { game: true, gameId: true },
    });
    await tx.teamMember.deleteMany({ where: { userId: me.id } });
    await tx.gameProfile.deleteMany({ where: { userId: me.id } });
    await tx.pushSubscription.deleteMany({ where: { userId: me.id } });
    await tx.payoutMethod.deleteMany({ where: { userId: me.id } });
    await tx.user.update({
      where: { id: me.id },
      data: {
        displayName: null,
        avatarUrl: null,
        dateOfBirth: null,
        pushOptIn: false,
        // The email is freed (the phone stays reserved, DECISIONS M7).
        email: null,
        emailVerifiedAt: null,
        // Free the Google account and drop the password so the person can sign up again (M39).
        googleId: null,
        passwordHash: null,
        deletedAt: now,
      },
    });
    await writeAudit(tx, {
      actorId: approvedById,
      action: "user.deleteAccount",
      entityType: "User",
      entityId: me.id,
      before: { ...before, gameProfiles: games },
      after: { deletedAt: now, cancelledRegistrations: ownRegs.map((r) => r.id) },
    });
  });

  if (refunds.length) await executeRefunds(refunds);
  await Promise.all(events.map(notify));
}

export const PHONE_CHANGE_LIMIT = { limit: 5, windowSeconds: 3600 };

const changePhoneSchema = z.object({ idToken: z.string().min(10).max(5000) });

/**
 * Change my phone number: the client proves the new number with the same OTP flow as login
 * (Firebase ID token, or the stub token in dev/tests) and the server verifies it here.
 */
export async function changePhone(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { idToken } = parseInput(changePhoneSchema, input);
  await enforceRateLimit(
    `phone-change:${me.id}`,
    PHONE_CHANGE_LIMIT.limit,
    PHONE_CHANGE_LIMIT.windowSeconds,
    "Too many attempts. Please wait an hour and try again.",
  );
  const { phone } = await getOtpVerifier().verify(idToken);
  const bans = await db.ban.findMany({
    where: { phone },
    select: { expiresAt: true, liftedAt: true },
  });
  if (bans.some((b) => isBanRecordActive(b)))
    throw new AppError("BANNED", "That phone number is banned.");
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: me.id }, select: { phone: true } });
      if (before.phone === phone)
        throw new AppError("VALIDATION", "That is already your phone number.");
      const owner = await tx.user.findUnique({ where: { phone }, select: { id: true } });
      if (owner) throw new AppError("CONFLICT", "That phone number belongs to another account.");
      await tx.user.update({ where: { id: me.id }, data: { phone } });
      await writeAudit(tx, {
        actorId: me.id,
        action: "user.changePhone",
        entityType: "User",
        entityId: me.id,
        before,
        after: { phone },
      });
      return { phone };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("CONFLICT", "That phone number belongs to another account.");
    throw e;
  }
}
