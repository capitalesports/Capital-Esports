import { beforeEach, describe, expect, it } from "vitest";
import { cancelMatch } from "@/server/services/matches";
import {
  approveManualPayment,
  expireManualPayments,
  rejectManualPayment,
  setPaymentQr,
  submitManualPayment,
} from "@/server/services/manual-payments";
import { registerForMatch } from "@/server/services/registration";
import { normalizeTransactionId } from "@/lib/manual-payments";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

/** Manual UPI payments: QR, proof upload, admin approval (DECISIONS M54). */

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
let admin: Actor;
let mod: Actor;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

/** A Rs 70 scrim that takes payment by the admin's QR (online payments stay off). */
async function qrMatch(maxSlots = 2) {
  const m = await createMatch(admin.id, { entryFeePaise: 7000, maxSlots, capped: true });
  await setPaymentQr(admin, { matchId: m.id }, PNG);
  return testDb().match.findUniqueOrThrow({ where: { id: m.id } });
}
const regOf = (matchId: string, userId: string) =>
  testDb().registration.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId } } });
const proof = (matchId: string, transactionId = "412345678901") => ({
  matchId,
  app: "GOOGLE_PAY",
  transactionId,
});

describe("payment QR", () => {
  it("only admins set it; it opens paid registration even with online payments off", async () => {
    const m = await createMatch(admin.id, { entryFeePaise: 7000, maxSlots: 2, capped: true });
    await expect(setPaymentQr(mod, { matchId: m.id }, PNG)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      setPaymentQr(admin, { matchId: m.id }, new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const p = await createPlayer();
    // Without a QR (and without online payments) paid entries stay closed.
    await expect(registerForMatch(player(p), { matchId: m.id })).rejects.toBeTruthy();
    await setPaymentQr(admin, { matchId: m.id }, PNG);
    const r = await registerForMatch(player(p), { matchId: m.id });
    expect(r.status).toBe("PENDING_PAYMENT");
    const mp = await testDb().manualPayment.findFirstOrThrow({ where: { matchId: m.id } });
    expect(mp).toMatchObject({ status: "AWAITING_PROOF", amountPaise: 7000 });
    // No "Slot confirmed" before an admin approves.
    expect(await testDb().notification.count({ where: { type: "REGISTRATION_CONFIRMED" } })).toBe(
      0,
    );
  });
});

describe("proof and approval", () => {
  it("validates the proof, then an admin approval confirms the slot and records a PAID payment", async () => {
    const m = await qrMatch();
    const p = await createPlayer();
    await registerForMatch(player(p), { matchId: m.id });
    await expect(submitManualPayment(player(p), proof(m.id, "12"), PNG)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      submitManualPayment(player(p), { ...proof(m.id), app: "VENMO" }, PNG),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      submitManualPayment(player(p), proof(m.id), new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await submitManualPayment(player(p), proof(m.id, " 4123 4567 8901 "), PNG);
    const mp = await testDb().manualPayment.findFirstOrThrow({ where: { matchId: m.id } });
    expect(mp).toMatchObject({
      status: "SUBMITTED",
      transactionId: "412345678901",
      app: "GOOGLE_PAY",
    });
    expect((await regOf(m.id, p.id)).status).toBe("PENDING_PAYMENT");

    await expect(approveManualPayment(mod, { manualPaymentId: mp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await approveManualPayment(admin, { manualPaymentId: mp.id });
    const reg = await regOf(m.id, p.id);
    expect(reg.status).toBe("CONFIRMED");
    const pay = await testDb().payment.findUniqueOrThrow({ where: { registrationId: reg.id } });
    expect(pay).toMatchObject({ status: "PAID", amountPaise: 7000, orderId: `manual_${mp.id}` });
    expect(
      await testDb().notification.count({
        where: { type: "REGISTRATION_CONFIRMED", userId: p.id },
      }),
    ).toBe(1);
    await expect(approveManualPayment(admin, { manualPaymentId: mp.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("one transaction ID can't pay for two entries, and nobody uploads for someone else", async () => {
    const m = await qrMatch(5);
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    await registerForMatch(player(b), { matchId: m.id });
    await submitManualPayment(player(a), proof(m.id), PNG);
    await expect(submitManualPayment(player(b), proof(m.id), PNG)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const stranger = await createPlayer();
    await expect(
      submitManualPayment(player(stranger), proof(m.id, "999999999999"), PNG),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejecting lets the player upload again; rejecting with 'free the slot' cancels the entry", async () => {
    const m = await qrMatch(5);
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    await registerForMatch(player(b), { matchId: m.id });
    await submitManualPayment(player(a), proof(m.id, "111111111111"), PNG);
    await submitManualPayment(player(b), proof(m.id, "222222222222"), PNG);
    const [ma, mb] = await Promise.all([
      testDb().manualPayment.findFirstOrThrow({ where: { userId: a.id } }),
      testDb().manualPayment.findFirstOrThrow({ where: { userId: b.id } }),
    ]);
    await expect(
      rejectManualPayment(admin, { manualPaymentId: ma.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await rejectManualPayment(admin, { manualPaymentId: ma.id, reason: "Amount not received" });
    expect((await regOf(m.id, a.id)).status).toBe("PENDING_PAYMENT");
    expect(
      await testDb().notification.count({ where: { type: "PAYMENT_REJECTED", userId: a.id } }),
    ).toBe(1);
    await submitManualPayment(player(a), proof(m.id, "333333333333"), PNG);
    expect((await testDb().manualPayment.findUniqueOrThrow({ where: { id: ma.id } })).status).toBe(
      "SUBMITTED",
    );

    await rejectManualPayment(admin, {
      manualPaymentId: mb.id,
      reason: "Fake screenshot",
      release: true,
    });
    expect((await regOf(m.id, b.id)).status).toBe("CANCELLED");
  });

  it("no proof in time releases the slot; proof waiting for review never expires", async () => {
    const m = await qrMatch(5);
    const [a, b] = [await createPlayer(), await createPlayer()];
    await registerForMatch(player(a), { matchId: m.id });
    await registerForMatch(player(b), { matchId: m.id });
    await submitManualPayment(player(b), proof(m.id), PNG);
    const later = addMinutes(new Date(), 45);
    expect(await expireManualPayments(later)).toEqual({ expired: 1 });
    expect((await regOf(m.id, a.id)).status).toBe("CANCELLED");
    expect((await regOf(m.id, b.id)).status).toBe("PENDING_PAYMENT");
  });

  it("cancelling a match leaves approved QR payments to refund by hand (no gateway call)", async () => {
    const m = await qrMatch();
    const p = await createPlayer();
    await registerForMatch(player(p), { matchId: m.id });
    await submitManualPayment(player(p), proof(m.id), PNG);
    const mp = await testDb().manualPayment.findFirstOrThrow({ where: { matchId: m.id } });
    await approveManualPayment(admin, { manualPaymentId: mp.id });
    await cancelMatch(admin, { matchId: m.id, reason: "Server outage" });
    const pay = await testDb().payment.findFirstOrThrow({ where: { matchId: m.id } });
    expect(pay.status).toBe("REFUND_PENDING");
  });
});

describe("transaction IDs", () => {
  it("are cleaned up and checked", () => {
    expect(normalizeTransactionId(" 4123-4567 8901 ")).toBe("412345678901");
    expect(normalizeTransactionId("t2310101234abc")).toBe("T2310101234ABC");
    expect(normalizeTransactionId("12345")).toBeNull();
    expect(normalizeTransactionId("<script>")).toBeNull();
  });
});
