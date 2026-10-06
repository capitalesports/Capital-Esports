import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { GAMES } from "@/lib/games";
import { assertAdmin, type Actor } from "@/lib/roles";
import { notify } from "./notify";

/** Recipients per notify() call (one createMany + pushes per batch). */
export const ANNOUNCEMENT_BATCH = 500;
/** The same title cannot be sent twice within this window (double-click / double-send guard). */
export const ANNOUNCEMENT_REPEAT_MINUTES = 5;

const link = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (v.startsWith("/") && !v.startsWith("//") && !/\s/.test(v)) return v;
    try {
      const u = new URL(v);
      if (u.protocol === "https:") return u.toString();
    } catch {
      // fall through
    }
    ctx.addIssue({
      code: "custom",
      message: "Use a site path like /tournaments or an https:// link",
    });
    return z.NEVER;
  });

export const announcementSchema = z.object({
  title: z.string().trim().min(3, "Title is too short").max(80, "Title is too long"),
  body: z.string().trim().min(3, "Message is too short").max(500, "Message is too long"),
  link,
  audience: z.enum(["ALL", ...GAMES]),
});

export type AnnouncementAudience = z.output<typeof announcementSchema>["audience"];

function recipientsWhere(audience: AnnouncementAudience): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    bannedAt: null,
    ...(audience === "ALL" ? {} : { gameProfiles: { some: { game: audience } } }),
  };
}

/**
 * Send an in-app (and push, for opted-in players) announcement to every player or to the players
 * of one game. Refuses the same title again within 5 minutes.
 */
export async function sendAnnouncement(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertAdmin(actor);
  const data = parseInput(announcementSchema, input);
  const since = new Date(now.getTime() - ANNOUNCEMENT_REPEAT_MINUTES * 60_000);

  const recipients = await db.$transaction(async (tx) => {
    // One sender at a time, so two clicks cannot both pass the repeat check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('announcement.send'))`;
    const recent = await tx.auditLog.findMany({
      where: { action: "announcement.send", createdAt: { gte: since } },
      select: { after: true },
    });
    const title = data.title.toLowerCase();
    const titleOf = (after: unknown) =>
      String((after as { title?: string } | null)?.title ?? "").toLowerCase();
    if (recent.some((r) => titleOf(r.after) === title)) {
      throw new AppError(
        "RATE_LIMITED",
        `An announcement with this title was sent in the last ${ANNOUNCEMENT_REPEAT_MINUTES} minutes.`,
      );
    }
    const users = await tx.user.findMany({
      where: recipientsWhere(data.audience),
      select: { id: true },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "announcement.send",
      entityType: "Announcement",
      entityId: data.audience,
      after: { ...data, recipients: users.length },
    });
    return users.map((u) => u.id);
  });

  for (let i = 0; i < recipients.length; i += ANNOUNCEMENT_BATCH) {
    await notify({
      type: "ANNOUNCEMENT",
      userIds: recipients.slice(i, i + ANNOUNCEMENT_BATCH),
      title: data.title,
      body: data.body,
      url: data.link,
    });
  }
  return { recipients: recipients.length };
}

/** Recently sent announcements (from the audit log). */
export async function listAnnouncements(actor: Actor | null, take = 20) {
  assertAdmin(actor);
  const rows = await db.auditLog.findMany({
    where: { action: "announcement.send" },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { displayName: true } } },
  });
  const deleted = new Set(
    (
      await db.auditLog.findMany({
        where: { action: "announcement.delete", entityId: { in: rows.map((r) => r.id) } },
        select: { entityId: true },
      })
    ).map((d) => d.entityId),
  );
  return rows.map((r) => {
    const a = (r.after ?? {}) as {
      title?: string;
      body?: string;
      link?: string | null;
      audience?: string;
      recipients?: number;
    };
    return {
      id: r.id,
      sentAt: r.createdAt,
      by: r.actor?.displayName ?? "Admin",
      title: a.title ?? "",
      body: a.body ?? "",
      link: a.link ?? null,
      audience: a.audience ?? r.entityId,
      recipients: a.recipients ?? 0,
      /** Taken back from every player's bell. */
      deleted: deleted.has(r.id),
    };
  });
}

/** How long after sending an announcement's notifications can still be matched to it. */
const DELIVERY_WINDOW_MS = 60 * 60_000;

/**
 * Take a sent announcement back: delete its notification from every player's bell (push messages
 * already delivered to phones cannot be recalled). Safe to repeat.
 */
export async function deleteAnnouncement(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { announcementId } = parseInput(z.object({ announcementId: z.string().min(1) }), input);
  const sent = await db.auditLog.findFirst({
    where: { id: announcementId, action: "announcement.send" },
  });
  if (!sent) throw new AppError("NOT_FOUND", "Announcement not found.");
  const a = (sent.after ?? {}) as { title?: string; body?: string };
  // Its notifications were created after it was sent and before the next announcement.
  const next = await db.auditLog.findFirst({
    where: { action: "announcement.send", createdAt: { gt: sent.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const until = new Date(
    Math.min(sent.createdAt.getTime() + DELIVERY_WINDOW_MS, next?.createdAt.getTime() ?? Infinity),
  );
  return db.$transaction(async (tx) => {
    const { count } = await tx.notification.deleteMany({
      where: {
        type: "ANNOUNCEMENT",
        title: a.title ?? "",
        body: a.body ?? "",
        createdAt: { gte: sent.createdAt, lt: until },
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "announcement.delete",
      entityType: "Announcement",
      entityId: sent.id,
      after: { title: a.title, removed: count },
    });
    return { removed: count };
  });
}

/** Empty every player's bell (all notifications of every kind). Typed confirmation required. */
export async function clearAllNotifications(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  parseInput(
    z.object({ confirm: z.literal("CLEAR", { message: "Type CLEAR to confirm" }) }),
    input,
  );
  return db.$transaction(async (tx) => {
    const { count } = await tx.notification.deleteMany({});
    await writeAudit(tx, {
      actorId: me.id,
      action: "notifications.clearAll",
      entityType: "Notification",
      entityId: "ALL",
      after: { removed: count },
    });
    return { removed: count };
  });
}
