import { beforeEach, describe, expect, it } from "vitest";
import { applyPaymentEvent } from "@/server/services/payments";
import { registerForMatch } from "@/server/services/registration";
import {
  claimReferral,
  getMyReferrals,
  getOrCreateReferralCode,
  getReferrerDetail,
  listReferrers,
  redeemReferralCredit,
  referralRewardsFor,
  referralsCsv,
} from "@/server/services/referrals";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

/** A confirmed registration, paid when `paise` > 0. */
async function slot(userId: string, paise = 0) {
  const m = await createMatch(admin.id, { entryFeePaise: paise });
  const r = await testDb().registration.create({
    data: { matchId: m.id, userId, status: "CONFIRMED", position: 1 },
  });
  if (paise > 0) {
    await testDb().payment.create({
      data: {
        userId,
        matchId: m.id,
        registrationId: r.id,
        orderId: `ord_${r.id}`,
        amountPaise: paise,
        status: "PAID",
        paidAt: new Date(),
        expiresAt: addMinutes(new Date(), 10),
      },
    });
  }
  return m;
}

describe("referral codes and claims (DECISIONS M52)", () => {
  it("gives every player one stable code", async () => {
    const k = await createPlayer("FREE_FIRE", { displayName: "khushi" });
    const code = await getOrCreateReferralCode(k.id);
    expect(code).toMatch(/^KHUSHI[A-Z2-9]{3}$/);
    expect(await getOrCreateReferralCode(k.id)).toBe(code);
  });

  it("credits a new account once, never itself, a stale account or an unknown code", async () => {
    const referrer = await createPlayer();
    const code = await getOrCreateReferralCode(referrer.id);
    const fresh = await createPlayer();
    expect(await claimReferral(fresh.id, "NOPE123")).toBeNull();
    expect(await claimReferral(fresh.id, code.toLowerCase())).toBe(referrer.id);
    // Only once.
    const other = await createPlayer();
    const otherCode = await getOrCreateReferralCode(other.id);
    expect(await claimReferral(fresh.id, otherCode)).toBeNull();
    expect((await testDb().user.findUniqueOrThrow({ where: { id: fresh.id } })).referredById).toBe(
      referrer.id,
    );
    // Not yourself; not an account older than 24 hours.
    expect(await claimReferral(referrer.id, code)).toBeNull();
    const old = await createPlayer();
    await testDb().user.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await claimReferral(old.id, code)).toBeNull();
    // Not to a banned referrer.
    await testDb().user.update({ where: { id: other.id }, data: { bannedAt: new Date() } });
    expect(await claimReferral((await createPlayer()).id, otherCode)).toBeNull();
    expect(await testDb().auditLog.count({ where: { action: "referral.claim" } })).toBe(1);
  });
});

describe("referral tracking", () => {
  it("shows the player who joined, and the admin how many (paid) slots they booked", async () => {
    const k = await createPlayer("FREE_FIRE", { displayName: "khushi" });
    const code = await getOrCreateReferralCode(k.id);
    const [a, b, c] = [await createPlayer(), await createPlayer(), await createPlayer()];
    for (const u of [a, b, c]) await claimReferral(u.id, code);
    await slot(a.id, 7000);
    await slot(a.id, 7000);
    await slot(a.id);
    await slot(b.id);

    // A second referrer: neither sees the other's players.
    const r = await createPlayer("FREE_FIRE", { displayName: "rohan" });
    const rCode = await getOrCreateReferralCode(r.id);
    const d = await createPlayer();
    await claimReferral(d.id, rCode);
    await slot(d.id, 5000);
    expect(await getMyReferrals(actor(r))).toMatchObject({ joined: 1, paidPlayers: 1 });

    const mine = await getMyReferrals(actor(k));
    expect(mine).toMatchObject({ code, joined: 3, booked: 2, paidPlayers: 1 });
    // Players never see amounts.
    expect(JSON.stringify(mine)).not.toContain("7000");

    const rows = await listReferrers(admin, { period: "all" });
    expect(rows.map((x) => x.name)).toEqual(["khushi", "rohan"]);
    expect(rows[0]).toMatchObject({
      referrerId: k.id,
      name: "khushi",
      code,
      joined: 3,
      booked: 2,
      paidPlayers: 1,
      slots: 4,
      paidSlots: 2,
      paidPaise: 14000,
    });

    const detail = await getReferrerDetail(admin, { referrerId: k.id, period: "7d" });
    expect(detail.players.map((p) => p.userId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(detail.players.find((p) => p.userId === a.id)?.payments).toHaveLength(2);

    const { csv } = await referralsCsv(admin, { period: "all" });
    expect(csv.split("\n")[0]).toBe(
      "referrer,referrer_code,player,joined_at,slots_booked,paid_slots,paid_rupees,last_paid_at",
    );
    expect(csv).toContain(",2,140.00,");
  });

  it("reports are admin-only and the player page needs a login", async () => {
    const mod: Actor = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
    const player = await createPlayer();
    for (const call of [
      (x: Actor | null) => listReferrers(x),
      (x: Actor | null) => getReferrerDetail(x, { referrerId: "x" }),
      (x: Actor | null) => referralsCsv(x),
    ]) {
      await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(call(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(actor(player))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(getMyReferrals(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getReferrerDetail(admin, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getReferrerDetail(admin, { referrerId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("referral reward: 5 paid referred players = 1 free slot (M52)", () => {
  async function referrerWithPaidPlayers(n: number) {
    const k = await createPlayer("FREE_FIRE", { displayName: "khushi" });
    const code = await getOrCreateReferralCode(k.id);
    for (let i = 0; i < n; i++) {
      const u = await createPlayer();
      await claimReferral(u.id, code);
      await slot(u.id, 7000);
    }
    return k;
  }
  async function pendingEntry(userId: string) {
    const m = await createMatch(admin.id, { entryFeePaise: 7000, maxSlots: 10, capped: true });
    process.env.PAYMENTS_ENABLED = "true";
    try {
      await registerForMatch(actor({ id: userId }), { matchId: m.id });
    } finally {
      delete process.env.PAYMENTS_ENABLED;
    }
    return m;
  }

  it("counts toward the next free slot and refuses to redeem without one", async () => {
    const k = await referrerWithPaidPlayers(4);
    expect(await referralRewardsFor(testDb(), k.id)).toEqual({
      earned: 0,
      used: 0,
      available: 0,
      towardNext: 4,
    });
    const m = await pendingEntry(k.id);
    await expect(redeemReferralCredit(actor(k), { matchId: m.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "You have no free slots yet.",
    });
  });

  it("confirms a paid entry without paying, once per free slot, and gives it back if cancelled", async () => {
    const k = await referrerWithPaidPlayers(5);
    expect((await referralRewardsFor(testDb(), k.id)).available).toBe(1);
    const m1 = await pendingEntry(k.id);
    await redeemReferralCredit(actor(k), { matchId: m1.id });
    const reg = await testDb().registration.findUniqueOrThrow({
      where: { matchId_userId: { matchId: m1.id, userId: k.id } },
    });
    expect(reg.status).toBe("CONFIRMED");
    expect(
      (await testDb().payment.findUniqueOrThrow({ where: { registrationId: reg.id } })).status,
    ).toBe("FAILED");
    expect(await referralRewardsFor(testDb(), k.id)).toMatchObject({ used: 1, available: 0 });
    expect(await testDb().auditLog.count({ where: { action: "referral.redeem" } })).toBe(1);

    // No second free slot.
    const m2 = await pendingEntry(k.id);
    await expect(redeemReferralCredit(actor(k), { matchId: m2.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Cancelled entry: the free slot comes back.
    await testDb().registration.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
    expect((await referralRewardsFor(testDb(), k.id)).available).toBe(1);
  });

  it("if the gateway payment completes anyway, the payment wins and the free slot returns", async () => {
    const k = await referrerWithPaidPlayers(5);
    const m = await pendingEntry(k.id);
    const reg = await testDb().registration.findUniqueOrThrow({
      where: { matchId_userId: { matchId: m.id, userId: k.id } },
    });
    const { orderId } = await testDb().payment.findUniqueOrThrow({
      where: { registrationId: reg.id },
    });
    await redeemReferralCredit(actor(k), { matchId: m.id });
    expect(await applyPaymentEvent(orderId, "SUCCESS", {})).toBe("CONFIRMED");
    expect(await referralRewardsFor(testDb(), k.id)).toMatchObject({ used: 0, available: 1 });
  });

  it("needs a login and an entry waiting for payment", async () => {
    await expect(redeemReferralCredit(null, { matchId: "x" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const p = await createPlayer();
    await expect(redeemReferralCredit(actor(p), {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(redeemReferralCredit(actor(p), { matchId: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
