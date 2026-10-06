import "server-only";
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
  const p = Math.max(1, page);
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

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this device's push subscription and turn push on for the player. */
export async function savePushSubscription(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { endpoint, keys } = parseInput(subscriptionSchema, input);
  await db.$transaction([
    db.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: me.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId: me.id, p256dh: keys.p256dh, auth: keys.auth },
    }),
    db.user.update({ where: { id: me.id }, data: { pushOptIn: true } }),
  ]);
}

/** Turn push off everywhere for the player (inbox keeps working). */
export async function disablePush(actor: Actor | null) {
  const me = assertUser(actor);
  await db.$transaction([
    db.pushSubscription.deleteMany({ where: { userId: me.id } }),
    db.user.update({ where: { id: me.id }, data: { pushOptIn: false } }),
  ]);
}
