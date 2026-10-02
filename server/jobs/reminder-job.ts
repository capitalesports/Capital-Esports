import "server-only";
import { db } from "@/server/db";
import { notify } from "@/server/services/notify";
import { ROOM_VISIBLE_STATUSES } from "@/lib/registration-rules";
import { addMinutes } from "@/lib/time";

/** Everyone with a confirmed slot: confirmed registrants plus confirmed roster members. */
export async function confirmedPlayerIds(matchId: string): Promise<string[]> {
  const regs = await db.registration.findMany({
    where: { matchId, status: "CONFIRMED" },
    select: { userId: true, members: { where: { status: "CONFIRMED" }, select: { userId: true } } },
  });
  // Roster players without an account (entered by game ID) have no inbox: skip them.
  return [
    ...new Set(
      regs.flatMap((r) => [r.userId, ...r.members.flatMap((m) => (m.userId ? [m.userId] : []))]),
    ),
  ];
}

const ACTIVE = ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] as const;

/**
 * Runs with the 5-minute cron. Each notice is sent at most once per match: the flag is set with a
 * conditional update first, so overlapping runs cannot double-send.
 */
export async function runReminderJob(now = new Date()) {
  let reminders = 0;
  let roomNotices = 0;

  const soon = await db.match.findMany({
    where: {
      isEntryList: false,
      status: { in: [...ACTIVE] },
      reminderSentAt: null,
      startsAt: { gt: now, lte: addMinutes(now, 30) },
    },
    select: { id: true },
  });
  for (const m of soon) {
    const { count } = await db.match.updateMany({
      where: { id: m.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (!count) continue;
    const userIds = await confirmedPlayerIds(m.id);
    await notify({ type: "MATCH_STARTING_SOON", userIds, matchId: m.id });
    reminders += userIds.length;
  }

  // Room notices normally go out when staff save the credentials; this catches any that didn't.
  const reveal = await db.match.findMany({
    where: {
      isEntryList: false,
      status: { in: [...ROOM_VISIBLE_STATUSES] },
      roomNoticeSentAt: null,
      roomId: { not: null },
      startsAt: { gt: addMinutes(now, -60) },
    },
    select: { id: true },
  });
  for (const m of reveal) {
    const { count } = await db.match.updateMany({
      where: { id: m.id, roomNoticeSentAt: null },
      data: { roomNoticeSentAt: now },
    });
    if (!count) continue;
    const userIds = await confirmedPlayerIds(m.id);
    await notify({ type: "ROOM_CREDENTIALS_AVAILABLE", userIds, matchId: m.id });
    roomNotices += userIds.length;
  }
  return { reminders, roomNotices };
}
