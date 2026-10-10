import "server-only";
import { enforceRateLimit } from "@/server/rate-limit";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { assertUser, type Actor } from "@/lib/roles";

export const INBOX_PAGE_SIZE = 30;

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function listMyNotifications(actor: Actor | null, page = 1) {
  const me = assertUser(actor);
  const p = Math.min(10_000, Math.max(1, Math.trunc(page) || 1));
  const [rows, total] = await Promise.all([
    db.notification.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * INBOX_PAGE_SIZE,
      take: INBOX_PAGE_SIZE,
    }),
    db.notification.count({ where: { userId: me.id } }),
  ]);
  return { rows, page: p, pages: Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE)) };
}

export async function markNotificationRead(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { id } = parseInput(z.object({ id: z.string().min(1) }), input);
  const { count } = await db.notification.updateMany({
    where: { id, userId: me.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (
    !count &&
    !(await db.notification.findFirst({ where: { id, userId: me.id }, select: { id: true } }))
  ) {
    throw new AppError("NOT_FOUND", "Notification not found.");
  }
}

export async function markAllNotificationsRead(actor: Actor | null) {
  const me = assertUser(actor);
  const { count } = await db.notification.updateMany({
    where: { userId: me.id, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

/** Delete every notification of the player (their own only). */
export async function clearMyNotifications(actor: Actor | null) {
  const me = assertUser(actor);
  const { count } = await db.notification.deleteMany({ where: { userId: me.id } });
  return count;
}

/** Real browser push services only (Chrome/Android, Firefox, Safari/iOS, Edge/Windows). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];
/** Devices per player that get push (the oldest is dropped beyond this). */
export const MAX_PUSH_SUBSCRIPTIONS = 5;

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .startsWith("https://")
    .max(1000)
    .refine(
      (v) => PUSH_HOSTS.some((h) => h.test(new URL(v).hostname)),
      "Not a browser push address",
    ),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this device's push subscription and turn push on for the player. */
export async function savePushSubscription(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { endpoint, keys } = parseInput(subscriptionSchema, input);
  await enforceRateLimit(
    `push:sub:${me.id}`,
    10,
    60 * 60,
    "Too many attempts. Please try again later.",
  );
  await db.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint } });
    // Never take over another player's device.
    if (existing && existing.userId !== me.id)
      throw new AppError("CONFLICT", "This device is linked to another account.");
    await tx.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: me.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { p256dh: keys.p256dh, auth: keys.auth },
    });
    // Keep only the newest few devices.
    const extra = await tx.pushSubscription.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      skip: MAX_PUSH_SUBSCRIPTIONS,
      select: { id: true },
    });
    if (extra.length)
      await tx.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    await tx.user.update({ where: { id: me.id }, data: { pushOptIn: true } });
  });
}

/** Turn push off everywhere for the player (inbox keeps working). */
export async function disablePush(actor: Actor | null) {
  const me = assertUser(actor);
  await db.$transaction([
    db.pushSubscription.deleteMany({ where: { userId: me.id } }),
    db.user.update({ where: { id: me.id }, data: { pushOptIn: false } }),
  ]);
}
