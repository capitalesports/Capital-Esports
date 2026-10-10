import "server-only";
import { db } from "@/server/db";
import { getEmailSender, renderEmail } from "@/server/providers/email";
import { getPushSender, getReminderChannels } from "@/server/providers/notification-channels";
import { formatINR } from "@/lib/money";
import { SITE_NAME } from "@/lib/site";
import {
  EMAIL_EVENTS,
  messageFor,
  PUSH_EVENTS,
  REMINDER_EVENTS,
  type NotificationContext,
  type NotificationEvent,
  type NotificationMessage,
} from "@/lib/notifications";
import { absoluteUrl } from "./email";

export type { NotificationEvent } from "@/lib/notifications";

async function contextFor(event: NotificationEvent): Promise<NotificationContext> {
  if ("matchId" in event && event.matchId) {
    const m = await db.match.findUnique({
      where: { id: event.matchId },
      select: { title: true, isEntryList: true, tournament: { select: { format: true } } },
    });
    return {
      matchTitle: m?.title,
      signUpFormat: m?.isEntryList ? m.tournament?.format : undefined,
    };
  }
  if (event.type === "TEAM_INVITE") {
    const t = await db.team.findUnique({ where: { id: event.teamId }, select: { name: true } });
    return { teamName: t?.name };
  }
  if (event.type === "PAYOUT_STATUS") {
    const p = await db.payout.findUnique({
      where: { id: event.payoutId },
      select: { amountPaise: true },
    });
    return { amount: p ? formatINR(p.amountPaise) : undefined };
  }
  return {};
}

/** Email copies for players with a verified email and email notifications on. One failure doesn't stop the rest. */
async function emailCopies(userIds: string[], message: NotificationMessage) {
  const users = await db.user.findMany({
    where: {
      id: { in: userIds },
      emailVerifiedAt: { not: null },
      emailOptIn: true,
      deletedAt: null,
      email: { not: null },
    },
    select: { email: true },
  });
  if (!users.length) return;
  const sender = getEmailSender();
  const content = renderEmail({
    title: message.title,
    body: message.body,
    link: { url: absoluteUrl(message.url), label: message.linkLabel ?? `Open ${SITE_NAME}` },
  });
  for (const u of users) {
    try {
      await sender.send({ to: u.email!, subject: message.title, ...content });
    } catch (e) {
      console.error("email notification failed", message.type, e);
    }
  }
}

/**
 * Deliver an event: always an in-app notification; a push to opted-in players' devices for
 * important events; an email copy to verified, opted-in emails; and reminder channels
 * (WhatsApp/SMS) for match reminders.
 * Delivery failures never fail the calling mutation.
 */
export async function notify(event: NotificationEvent): Promise<void> {
  const userIds = [...new Set(event.userIds)];
  if (!userIds.length) return;
  try {
    const message = messageFor(event, await contextFor(event));
    await db.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: message.type,
        title: message.title,
        body: message.body,
        url: message.url,
      })),
    });

    if (PUSH_EVENTS.has(event.type)) {
      const subs = await db.pushSubscription.findMany({
        where: { userId: { in: userIds }, user: { pushOptIn: true } },
      });
      const sender = getPushSender();
      // In parallel, each capped at 5 seconds: one slow push service can't hold up the rest.
      const timeout = () => new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000));
      await Promise.all(
        subs.map(async (sub) => {
          try {
            const result = await Promise.race([
              sender.send(sub, { title: message.title, body: message.body, url: message.url }),
              timeout(),
            ]);
            if (result === "gone") await db.pushSubscription.deleteMany({ where: { id: sub.id } });
          } catch (e) {
            console.error("push failed", sub.id, e);
          }
        }),
      );
    }

    if (EMAIL_EVENTS.has(event.type)) await emailCopies(userIds, message);

    if (REMINDER_EVENTS.has(event.type)) {
      // WhatsApp/SMS reminders need a phone; Google sign-ups may have none (DECISIONS M31).
      const users = await db.user.findMany({
        where: { id: { in: userIds }, phone: { not: null } },
        select: { id: true, phone: true },
      });
      for (const channel of getReminderChannels()) {
        for (const u of users) await channel.send({ userId: u.id, phone: u.phone! }, message);
      }
    }
  } catch (e) {
    console.error("notify failed", event.type, e);
  }
}
