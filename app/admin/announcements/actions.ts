"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import {
  clearAllNotifications,
  deleteAnnouncement,
  sendAnnouncement,
} from "@/server/services/announcements";

export async function sendAnnouncementAction(input: {
  title: string;
  body: string;
  link: string;
  audience: string;
}) {
  return runAction(async () => {
    const result = await sendAnnouncement(await requireAdmin(), input);
    revalidatePath("/admin/announcements");
    return result.recipients;
  }, "Announcement sent");
}

export async function deleteAnnouncementAction(input: { announcementId: string }) {
  return runAction(async () => {
    const r = await deleteAnnouncement(await requireAdmin(), input);
    revalidatePath("/admin/announcements");
    revalidatePath("/", "layout");
    return r.removed;
  }, "Removed from every player's notifications");
}

export async function clearAllNotificationsAction(input: { confirm: string }) {
  return runAction(async () => {
    const r = await clearAllNotifications(await requireAdmin(), input);
    revalidatePath("/admin/announcements");
    revalidatePath("/", "layout");
    return r.removed;
  }, "Every player's notifications cleared");
}
