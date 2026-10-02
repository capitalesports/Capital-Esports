"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import { sendAnnouncement } from "@/server/services/announcements";

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
