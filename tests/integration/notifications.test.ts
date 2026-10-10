import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const pushed: { endpoint: string; title: string }[] = [];
let goneEndpoints = new Set<string>();
const reminders: string[] = [];
vi.mock("@/server/providers/notification-channels", () => ({
  vapidPublicKey: () => null,
  getPushSender: () => ({
    kind: "stub",
    send: async (sub: { endpoint: string }, payload: { title: string }) => {
      pushed.push({ endpoint: sub.endpoint, title: payload.title });
      return goneEndpoints.has(sub.endpoint) ? "gone" : "sent";
    },
  }),
  getReminderChannels: () => [{ name: "test", send: async (to: { userId: string }) => void reminders.push(to.userId) }],
}));

const { notify } = await import("@/server/services/notify");
const { runReminderJob } = await import("@/server/jobs/reminder-job");
const { clearMyNotifications, listMyNotifications, markAllNotificationsRead, markNotificationRead, savePushSubscription, disablePush, unreadCount } = await import(
  "@/server/services/inbox"
);

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let adminId: string;

beforeEach(async () => {
  await resetDb();
  pushed.length = 0;
  reminders.length = 0;
  goneEndpoints = new Set();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

describe("notify", () => {
  it("writes an inbox row per user and pushes only to opted-in devices", async () => {
    const m = await createMatch(adminId, { title: "Evening Scrim" });
    const [a, b] = [await createPlayer(), await createPlayer()];
    await savePushSubscription(player(a), { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "p256dh-key-aaaa", auth: "auth-aaaa" } });
    await notify({ type: "REGISTRATION_CONFIRMED", userIds: [a.id, b.id, a.id], matchId: m.id });
    const rows = await testDb().notification.findMany({ orderBy: { userId: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "REGISTRATION_CONFIRMED", title: "Slot confirmed", url: `/scrims/${m.id}` });
    expect(rows[0]!.body).toContain("Evening Scrim");
    expect(pushed).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/a", title: "Slot confirmed" }]);
  });

  it("drops subscriptions the push service reports as gone", async () => {
    const a = await createPlayer();
    await savePushSubscription(player(a), { endpoint: "https://fcm.googleapis.com/fcm/send/gone", keys: { p256dh: "p256dh-key-aaaa", auth: "auth-aaaa" } });
    goneEndpoints.add("https://fcm.googleapis.com/fcm/send/gone");
    await notify({ type: "RESULTS_APPROVED", userIds: [a.id], matchId: (await createMatch(adminId)).id });
    expect(await testDb().pushSubscription.count()).toBe(0);
  });

  it("never throws into the calling mutation", async () => {
    await expect(notify({ type: "REGISTRATION_CONFIRMED", userIds: ["no-such-user"], matchId: "x" })).resolves.toBeUndefined();
  });
});

describe("reminder job", () => {
  it("a match reaching startsAt - 30 min notifies every confirmed player once", async () => {
    const m = await createMatch(adminId, { status: "REGISTRATION_CLOSED", startsAt: addMinutes(new Date(), 29), mode: "SQUAD", maxSlots: 4, title: "Squad Night" });
    const solo = await createPlayer();
    const [captain, mate, invited] = [await createPlayer(), await createPlayer(), await createPlayer()];
    const waitlisted = await createPlayer();
    await testDb().registration.create({ data: { matchId: m.id, userId: solo.id, status: "CONFIRMED", position: 1 } });
    const squad = await testDb().registration.create({ data: { matchId: m.id, userId: captain.id, status: "CONFIRMED", position: 2 } });
    await testDb().registrationMember.createMany({
      data: [
        { registrationId: squad.id, matchId: m.id, userId: captain.id, status: "CONFIRMED" },
        { registrationId: squad.id, matchId: m.id, userId: mate.id, status: "CONFIRMED" },
        { registrationId: squad.id, matchId: m.id, userId: invited.id, status: "INVITED" },
      ],
    });
    await testDb().registration.create({ data: { matchId: m.id, userId: waitlisted.id, status: "WAITLISTED", position: 3 } });
    const later = await createMatch(adminId, { status: "REGISTRATION_OPEN", startsAt: addMinutes(new Date(), 45) });
    await testDb().registration.create({ data: { matchId: later.id, userId: solo.id, status: "CONFIRMED", position: 1 } });

    expect(await runReminderJob()).toEqual({ reminders: 3, roomNotices: 0 });
    const notified = (await testDb().notification.findMany({ where: { type: "MATCH_STARTING_SOON" } })).map((n) => n.userId).sort();
    expect(notified).toEqual([solo.id, captain.id, mate.id].sort());
    expect(reminders.sort()).toEqual([solo.id, captain.id, mate.id].sort());
    // Once only.
    expect(await runReminderJob()).toEqual({ reminders: 0, roomNotices: 0 });
    expect(await testDb().notification.count({ where: { type: "MATCH_STARTING_SOON" } })).toBe(3);
  });

  it("announces room credentials once they are set (any time before the start, DECISIONS M20)", async () => {
    const m = await createMatch(adminId, { status: "REGISTRATION_OPEN", startsAt: addMinutes(new Date(), 60 * 24) });
    const p = await createPlayer();
    await testDb().registration.create({ data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    await testDb().match.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
    expect(await runReminderJob()).toEqual({ reminders: 0, roomNotices: 0 }); // no credentials yet
    await testDb().match.update({ where: { id: m.id }, data: { roomId: "123", roomPassword: "pw" } });
    expect(await runReminderJob()).toEqual({ reminders: 0, roomNotices: 1 });
    expect(await runReminderJob()).toEqual({ reminders: 0, roomNotices: 0 });
    const n = await testDb().notification.findFirstOrThrow({ where: { type: "ROOM_CREDENTIALS_AVAILABLE" } });
    expect(n.body).not.toContain("pw");
  });

  it("skips cancelled matches and tournament sign-up lists", async () => {
    const c = await createMatch(adminId, { status: "CANCELLED", startsAt: addMinutes(new Date(), 20) });
    const p = await createPlayer();
    await testDb().registration.create({ data: { matchId: c.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    expect(await runReminderJob()).toEqual({ reminders: 0, roomNotices: 0 });
  });
});

describe("inbox", () => {
  it("lists, counts and marks my notifications only", async () => {
    const [a, b] = [await createPlayer(), await createPlayer()];
    const m = await createMatch(adminId);
    await notify({ type: "RESULTS_APPROVED", userIds: [a.id, b.id], matchId: m.id });
    await notify({ type: "MATCH_STARTING_SOON", userIds: [a.id], matchId: m.id });
    expect(await unreadCount(a.id)).toBe(2);
    const { rows } = await listMyNotifications(player(a));
    expect(rows).toHaveLength(2);
    const bRow = await testDb().notification.findFirstOrThrow({ where: { userId: b.id } });
    await expect(markNotificationRead(player(a), { id: bRow.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markNotificationRead(player(a), { id: rows[0]!.id });
    expect(await unreadCount(a.id)).toBe(1);
    expect(await markAllNotificationsRead(player(a))).toBe(1);
    expect(await unreadCount(a.id)).toBe(0);
    expect(await unreadCount(b.id)).toBe(1);
    await expect(listMyNotifications(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    // Clear all deletes only the player's own notifications.
    await expect(clearMyNotifications(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await clearMyNotifications(player(a))).toBe(2);
    expect(await testDb().notification.count({ where: { userId: a.id } })).toBe(0);
    expect(await testDb().notification.count({ where: { userId: b.id } })).toBe(1);
  });

  it("validates push subscriptions and lets players turn push off", async () => {
    const a = await createPlayer();
    await expect(savePushSubscription(player(a), { endpoint: "http://insecure.example", keys: { p256dh: "p256dh-key-aaaa", auth: "auth-aaaa" } })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(savePushSubscription(null, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await savePushSubscription(player(a), { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "p256dh-key-aaaa", auth: "auth-aaaa" } });
    expect((await testDb().user.findUniqueOrThrow({ where: { id: a.id } })).pushOptIn).toBe(true);
    await disablePush(player(a));
    expect(await testDb().pushSubscription.count()).toBe(0);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: a.id } })).pushOptIn).toBe(false);
  });
});

describe("push subscription limits (security review)", () => {
  it("accepts only browser push services, keeps 5 devices, and never takes over another player's device", async () => {
    const a = await createPlayer();
    const b = await createPlayer();
    const keys = { p256dh: "p256dh-key-aaaa", auth: "auth-aaaa" };
    await expect(
      savePushSubscription(player(a), { endpoint: "https://attacker.example/slow", keys }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    for (let i = 0; i < 7; i++)
      await savePushSubscription(player(a), {
        endpoint: `https://fcm.googleapis.com/fcm/send/dev${i}`,
        keys,
      });
    expect(await testDb().pushSubscription.count({ where: { userId: a.id } })).toBe(5);
    await expect(
      savePushSubscription(player(b), {
        endpoint: "https://fcm.googleapis.com/fcm/send/dev6",
        keys,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
