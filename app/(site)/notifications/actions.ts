"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/guards";
import {
  clearMyNotifications,
  disablePush,
  markAllNotificationsRead,
  markNotificationRead,
  savePushSubscription,
} from "@/server/services/inbox";

export async function markReadAction(input: { id: string }) {
  return runAction(async () => {
    await markNotificationRead(await requireUser(), input);
    revalidatePath("/", "layout");
  });
}

export async function markAllReadAction() {
  return runAction(async () => {
    await markAllNotificationsRead(await requireUser());
    revalidatePath("/", "layout");
  }, "All caught up");
}

export async function clearNotificationsAction() {
  return runAction(async () => {
    await clearMyNotifications(await requireUser());
    revalidatePath("/", "layout");
  }, "Notifications cleared");
}

export async function savePushSubscriptionAction(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  return runAction(async () => {
    await savePushSubscription(await requireUser(), input);
    revalidatePath("/dashboard");
  }, "Notifications enabled on this device");
}

export async function disablePushAction() {
  return runAction(async () => {
    await disablePush(await requireUser());
    revalidatePath("/dashboard");
  }, "Push notifications turned off");
}
