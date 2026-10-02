import { beforeEach, describe, expect, it } from "vitest";
import { changePhone, deleteAccount } from "@/server/services/profile";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let admin: Actor;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

describe("deleteAccount", () => {
  it("requires a logged-in user", async () => {
    await expect(deleteAccount(null, { confirm: "DELETE" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("requires the word DELETE", async () => {
    const me = player(await createPlayer());
    for (const confirm of ["delete", "", "DELETE ", undefined]) {
      await expect(deleteAccount(me, { confirm })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await testDb().user.findUniqueOrThrow({ where: { id: me.id } })).deletedAt).toBeNull();
  });

  it("refuses a team captain", async () => {
    const u = await createPlayer();
    await testDb().team.create({
      data: {
        game: "FREE_FIRE",
        name: "Alpha",
        captainId: u.id,
        members: { create: { userId: u.id, game: "FREE_FIRE", status: "CONFIRMED" } },
      },
    });
    await expect(deleteAccount(player(u), { confirm: "DELETE" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("captain"),
    });
  });

  it("refuses while a payout is pending, but ignores voided and paid ones", async () => {
    const u = await createPlayer();
    const m = await createMatch(admin.id, { status: "COMPLETED" });
    const payout = await testDb().payout.create({
      data: { userId: u.id, matchId: m.id, place: 1, amountPaise: 10000, status: "PENDING" },
    });
    await expect(deleteAccount(player(u), { confirm: "DELETE" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await testDb().payout.update({ where: { id: payout.id }, data: { voidedAt: new Date() } });
    await expect(deleteAccount(player(u), { confirm: "DELETE" })).resolves.toBeUndefined();
  });

  it("refuses while in a match that can no longer be cancelled", async () => {
    const u = await createPlayer();
    const m = await createMatch(admin.id, { status: "REGISTRATION_CLOSED" });
    await testDb().registration.create({
      data: { matchId: m.id, userId: u.id, status: "CONFIRMED", position: 1 },
    });
    await expect(deleteAccount(player(u), { confirm: "DELETE" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("cancels upcoming entries (refunding paid ones), clears personal data and audits", async () => {
    const u = await createPlayer("FREE_FIRE");
    const other = await createPlayer();
    const free = await createMatch(admin.id, { maxSlots: 1 });
    const paid = await createMatch(admin.id, { entryFeePaise: 5000, startsAt: addMinutes(new Date(), 300) });
    await testDb().registration.create({
      data: { matchId: free.id, userId: u.id, status: "CONFIRMED", position: 1 },
    });
    await testDb().registration.create({
      data: { matchId: free.id, userId: other.id, status: "WAITLISTED", position: 2 },
    });
    const paidReg = await testDb().registration.create({
      data: { matchId: paid.id, userId: u.id, status: "CONFIRMED", position: 1 },
    });
    const payment = await testDb().payment.create({
      data: {
        userId: u.id,
        matchId: paid.id,
        registrationId: paidReg.id,
        orderId: "ord_delete_test",
        amountPaise: 5000,
        status: "PAID",
        paidAt: new Date(),
        expiresAt: addMinutes(new Date(), 10),
      },
    });
    await testDb().registration.update({ where: { id: paidReg.id }, data: { paymentId: payment.id } });
    const team = await testDb().team.create({
      data: {
        game: "FREE_FIRE",
        name: "Bravo",
        captainId: other.id,
        members: {
          create: [
            { userId: other.id, game: "FREE_FIRE", status: "CONFIRMED" },
            { userId: u.id, game: "FREE_FIRE", status: "CONFIRMED" },
          ],
        },
      },
    });
    await testDb().pushSubscription.create({
      data: { userId: u.id, endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
    });

    await deleteAccount(player(u), { confirm: "DELETE" });

    const after = await testDb().user.findUniqueOrThrow({
      where: { id: u.id },
      include: { gameProfiles: true, teamMemberships: true, pushSubscriptions: true },
    });
    expect(after.deletedAt).not.toBeNull();
    expect(after).toMatchObject({ displayName: null, avatarUrl: null, dateOfBirth: null });
    expect(after.gameProfiles).toHaveLength(0);
    expect(after.teamMemberships).toHaveLength(0);
    expect(after.pushSubscriptions).toHaveLength(0);
    expect(await testDb().team.findUnique({ where: { id: team.id } })).not.toBeNull();

    const regs = await testDb().registration.findMany({ where: { userId: u.id } });
    expect(regs.every((r) => r.status === "CANCELLED")).toBe(true);
    // The freed slot went to the waitlist.
    expect(
      (await testDb().registration.findUniqueOrThrow({
        where: { matchId_userId: { matchId: free.id, userId: other.id } },
      })).status,
    ).toBe("CONFIRMED");
    const refunded = await testDb().payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(["REFUND_PENDING", "REFUNDED"]).toContain(refunded.status);
    expect(
      await testDb().auditLog.count({ where: { action: "user.deleteAccount", entityId: u.id } }),
    ).toBe(1);
  });
});

describe("changePhone", () => {
  it("requires a logged-in user", async () => {
    await expect(changePhone(null, { idToken: "stub:+919812345678" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("validates the token", async () => {
    const me = player(await createPlayer());
    await expect(changePhone(me, { idToken: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(changePhone(me, { idToken: "not-a-stub-token" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("refuses a number that belongs to another account", async () => {
    const taken = await createUser({ phone: "+919811111111" });
    const me = player(await createPlayer());
    await expect(changePhone(me, { idToken: `stub:${taken.phone}` })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("updates the phone after verification and audits it", async () => {
    const u = await createPlayer();
    await expect(changePhone(player(u), { idToken: "stub:+919822222222" })).resolves.toEqual({
      phone: "+919822222222",
    });
    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).phone).toBe(
      "+919822222222",
    );
    const log = await testDb().auditLog.findFirstOrThrow({ where: { action: "user.changePhone" } });
    expect(log.before).toEqual({ phone: u.phone });
  });
});
