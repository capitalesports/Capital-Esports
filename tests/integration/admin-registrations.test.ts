import { beforeEach, describe, expect, it } from "vitest";
import {
  adminPromoteRegistration,
  adminRemoveRegistration,
  listMatchRegistrations,
} from "@/server/services/admin-registrations";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
const player: Actor = { id: "p", role: "PLAYER" };

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

async function reg(matchId: string, userId: string, status: "CONFIRMED" | "WAITLISTED", position: number) {
  return testDb().registration.create({ data: { matchId, userId, status, position } });
}

async function paid(matchId: string, userId: string, position: number) {
  const r = await reg(matchId, userId, "CONFIRMED", position);
  const p = await testDb().payment.create({
    data: {
      userId,
      matchId,
      registrationId: r.id,
      orderId: `ord_${r.id}`,
      amountPaise: 5000,
      status: "PAID",
      paidAt: new Date(),
      expiresAt: addMinutes(new Date(), 10),
    },
  });
  return testDb().registration.update({ where: { id: r.id }, data: { paymentId: p.id } });
}

describe("registrations manager: roles and validation", () => {
  it("is moderator-only", async () => {
    for (const a of [null, player]) {
      await expect(listMatchRegistrations(a, "x")).rejects.toMatchObject({
        code: a ? "FORBIDDEN" : "UNAUTHENTICATED",
      });
      await expect(
        adminRemoveRegistration(a, { registrationId: "x", reason: "Wrong ID" }),
      ).rejects.toMatchObject({ code: a ? "FORBIDDEN" : "UNAUTHENTICATED" });
      await expect(adminPromoteRegistration(a, { registrationId: "x" })).rejects.toMatchObject({
        code: a ? "FORBIDDEN" : "UNAUTHENTICATED",
      });
    }
  });

  it("validates input", async () => {
    await expect(
      adminRemoveRegistration(mod, { registrationId: "x", reason: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(adminRemoveRegistration(mod, { reason: "Wrong ID" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(adminPromoteRegistration(mod, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      adminRemoveRegistration(mod, { registrationId: "missing", reason: "Wrong ID" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("registrations manager", () => {
  it("lists entries with roster game IDs and payment status", async () => {
    const m = await createMatch(admin.id, { game: "BGMI", mode: "DUO", entryFeePaise: 5000 });
    const [cap, mate] = await Promise.all([createPlayer("BGMI"), createPlayer("BGMI")]);
    const team = await testDb().team.create({
      data: { game: "BGMI", name: "Wolves", captainId: cap.id },
    });
    const r = await paid(m.id, cap.id, 1);
    await testDb().registration.update({ where: { id: r.id }, data: { teamId: team.id } });
    await testDb().registrationMember.createMany({
      data: [
        { registrationId: r.id, matchId: m.id, userId: cap.id, status: "CONFIRMED" },
        { registrationId: r.id, matchId: m.id, userId: mate.id, status: "INVITED" },
      ],
    });
    const { rows, freeSlots } = await listMatchRegistrations(mod, m.id);
    expect(freeSlots).toBe(9);
    expect(rows[0]).toMatchObject({
      name: "Wolves",
      status: "CONFIRMED",
      payment: { status: "PAID", amountPaise: 5000 },
    });
    expect(rows[0]!.roster.map((p) => [p.gameId, p.status])).toEqual(
      expect.arrayContaining([
        [cap.gameProfiles[0]!.gameId, "CONFIRMED"],
        [mate.gameProfiles[0]!.gameId, "INVITED"],
      ]),
    );
  });

  it("removes a paid entry: refund, waitlist promotion, notifications and audit", async () => {
    const m = await createMatch(admin.id, { maxSlots: 1, entryFeePaise: 5000 });
    const [a, b] = await Promise.all([createUser(), createUser()]);
    const ra = await paid(m.id, a.id, 1);
    const rb = await reg(m.id, b.id, "WAITLISTED", 2);
    const out = await adminRemoveRegistration(mod, { registrationId: ra.id, reason: "Wrong game ID" });
    expect(out).toEqual({ refunded: true, promoted: 1 });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: ra.id } })).status).toBe(
      "CANCELLED",
    );
    // Paid match: the promoted player gets the payment window.
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: rb.id } })).status).toBe(
      "PENDING_PAYMENT",
    );
    const pay = await testDb().payment.findFirstOrThrow({ where: { registrationId: ra.id } });
    expect(["REFUND_PENDING", "REFUNDED"]).toContain(pay.status);
    const notes = await testDb().notification.findMany({ orderBy: { type: "asc" } });
    expect(notes.map((n) => [n.type, n.userId])).toEqual([
      ["REGISTRATION_REMOVED", a.id],
      ["WAITLIST_PROMOTED", b.id],
    ]);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: ra.id } });
    expect(audit).toMatchObject({ action: "registration.remove", actorId: mod.id });
    await expect(
      adminRemoveRegistration(mod, { registrationId: ra.id, reason: "Again please" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses removal once the match is live", async () => {
    const m = await createMatch(admin.id, { status: "LIVE" });
    const r = await reg(m.id, (await createUser()).id, "CONFIRMED", 1);
    await expect(
      adminRemoveRegistration(mod, { registrationId: r.id, reason: "Cheating" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("promotes a chosen waitlisted entry only when a slot is free", async () => {
    const m = await createMatch(admin.id, { maxSlots: 1 });
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()]);
    const ra = await reg(m.id, a.id, "CONFIRMED", 1);
    await reg(m.id, b.id, "WAITLISTED", 2);
    const rc = await reg(m.id, c.id, "WAITLISTED", 3);
    await expect(adminPromoteRegistration(mod, { registrationId: rc.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(adminPromoteRegistration(mod, { registrationId: ra.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await testDb().match.update({ where: { id: m.id }, data: { maxSlots: 2 } });
    expect(await adminPromoteRegistration(mod, { registrationId: rc.id })).toBe("CONFIRMED");
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: rc.id } })).status).toBe(
      "CONFIRMED",
    );
    expect(
      await testDb().auditLog.count({ where: { action: "registration.promote", entityId: rc.id } }),
    ).toBe(1);
    expect(
      await testDb().notification.count({ where: { type: "WAITLIST_PROMOTED", userId: c.id } }),
    ).toBe(1);
  });
});
