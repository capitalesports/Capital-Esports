import "server-only";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { banMessage, isAccountBanned, isBanRecordActive, type BanFields } from "@/lib/bans";
import { isProfileComplete } from "@/lib/profile";

export const SESSION_RATE_LIMITS = {
  perPhone: { limit: 5, windowSeconds: 15 * 60 },
  perIp: { limit: 30, windowSeconds: 15 * 60 },
} as const;

const RATE_LIMIT_MESSAGE = "Too many login attempts. Please wait 15 minutes and try again.";

export async function limitSessionByIp(ip: string): Promise<void> {
  const { limit, windowSeconds } = SESSION_RATE_LIMITS.perIp;
  await enforceRateLimit(`session:ip:${ip}`, limit, windowSeconds, RATE_LIMIT_MESSAGE);
}

/**
 * A banned phone number or email can't log in, whichever way the player proves who they are
 * (accounts may have no phone, DECISIONS M31). Missing values are skipped.
 */
export async function assertPhoneNotBanned(
  phone: string | null,
  email: string | null = null,
): Promise<void> {
  const where = [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])];
  if (!where.length) return;
  const bans = await db.ban.findMany({
    where: { OR: where },
    select: { phone: true, expiresAt: true, liftedAt: true, reason: true },
  });
  const activeBan = bans.find((b) => isBanRecordActive(b));
  if (activeBan) {
    throw new AppError(
      "BANNED",
      `This ${activeBan.phone ? "phone number" : "account"} is banned. Reason: ${activeBan.reason}. Contact support if you think this is a mistake.`,
    );
  }
}

/** Merged, deleted and banned accounts can't log in. */
export function assertAccountCanLogIn(
  user: BanFields & { deletedAt: Date | null; mergedIntoId: string | null },
): void {
  if (user.deletedAt) {
    throw new AppError(
      "FORBIDDEN",
      user.mergedIntoId
        ? "This account was merged into another account. Log in with your primary number or contact support."
        : "This account was deleted. Contact support if you need it back.",
    );
  }
  if (isAccountBanned(user)) throw new AppError("BANNED", banMessage(user));
}

/**
 * Log in (or sign up) the owner of a verified phone number.
 * Rejects banned phones/accounts and merged (soft-deleted) accounts.
 */
export async function loginWithVerifiedPhone(
  phone: string,
): Promise<{ id: string; isNew: boolean; profileComplete: boolean }> {
  const { limit, windowSeconds } = SESSION_RATE_LIMITS.perPhone;
  await enforceRateLimit(`session:phone:${phone}`, limit, windowSeconds, RATE_LIMIT_MESSAGE);

  await assertPhoneNotBanned(phone);
  const existing = await db.user.findUnique({
    where: { phone },
    include: { gameProfiles: { select: { game: true } } },
  });
  if (existing) {
    assertAccountCanLogIn(existing);
    return { id: existing.id, isNew: false, profileComplete: isProfileComplete(existing) };
  }

  try {
    const created = await db.user.create({ data: { phone } });
    return { id: created.id, isNew: true, profileComplete: false };
  } catch {
    // Concurrent first login with the same phone: the other request created it.
    const user = await db.user.findUniqueOrThrow({ where: { phone } });
    return { id: user.id, isNew: false, profileComplete: false };
  }
}
