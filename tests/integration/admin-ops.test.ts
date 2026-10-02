import { beforeEach, describe, expect, it } from "vitest";
import { adminRemoveTeamMember, adminTransferCaptain } from "@/server/services/admin-teams";
import { banUser, mergeUsers, unbanUser } from "@/server/services/admin-users";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

async function activeSeasonWithPoints(entries: [string, number][]) {
  const season = await testDb().season.create({
    data: {
      game: "FREE_FIRE",
      name: "S1",
      startsAt: addMinutes(new Date(), -60 * 24 * 10),
      endsAt: addMinutes(new Date(), 60 * 24 * 60),
      isActive: true,
    },
  });
  const m = await createMatch(admin.id, { status: "COMPLETED" });
  for (const [userId, points] of entries) {
    await testDb().pointsEntry.create({
      data: { seasonId: season.id, userId, matchId: m.id, points, reason: "scrim", placement: 1 },
    });
  }
  return season;
}

const board = async (seasonId: string) =>
  (await testDb().leaderboardSnapshot.findMany({ where: { seasonId }, orderBy: { rank: "asc" } })).map(
    (r) => r.userId,
  );

describe("ban side effects", () => {
  it("cancels upcoming registrations (refunding paid ones, promoting the waitlist) and drops the player from leaderboards", async () => {
    const [u, other, waiting] = await Promise.all([createPlayer(), createPlayer(), createPlayer()]);
    const season = await activeSeasonWithPoints([
      [u.id, 30],
      [other.id, 10],
    ]);
    const free = await createMatch(admin.id, { maxSlots: 1 });
    const paid = await createMatch(admin.id, { entryFeePaise: 5000 });
    const live = await createMatch(admin.id, { status: "LIVE" });
    await testDb().registration.createMany({
      data: [
        { matchId: free.id, userId: u.id, status: "CONFIRMED", position: 1 },
        { matchId: free.id, userId: waiting.id, status: "WAITLISTED", position: 2 },
        { matchId: live.id, userId: u.id, status: "CONFIRMED", position: 1 },
      ],
    });
    const paidReg = await testDb().registration.create({
      data: { matchId: paid.id, userId: u.id, status: "CONFIRMED", position: 1 },
    });
    const pay = await testDb().payment.create({
      data: {
        userId: u.id,
        matchId: paid.id,
        registrationId: paidReg.id,
        orderId: "ord_ban_test",
        amountPaise: 5000,
        status: "PAID",
        paidAt: new Date(),
        expiresAt: addMinutes(new Date(), 10),
      },
    });
    await testDb().registration.update({ where: { id: paidReg.id }, data: { paymentId: pay.id } });

    const out = await banUser(admin, { userId: u.id, reason: "Cheating" });
    expect(out).toEqual({ cancelledRegistrations: 2, refunds: 1 });
    const regs = await testDb().registration.findMany({ where: { userId: u.id } });
    expect(Object.fromEntries(regs.map((r) => [r.matchId, r.status]))).toEqual({
      [free.id]: "CANCELLED",
      [paid.id]: "CANCELLED",
      [live.id]: "CONFIRMED",
    });
    expect(
      (await testDb().registration.findFirstOrThrow({ where: { userId: waiting.id } })).status,
    ).toBe("CONFIRMED");
    expect(["REFUND_PENDING", "REFUNDED"]).toContain(
      (await testDb().payment.findUniqueOrThrow({ where: { id: pay.id } })).status,
    );
    expect(await board(season.id)).toEqual([other.id]);
    expect(await testDb().auditLog.count({ where: { action: "user.ban.cleanup" } })).toBe(1);

    await unbanUser(admin, { userId: u.id });
    expect(await board(season.id)).toEqual([u.id, other.id]);
  });

  it("cancels the team registration of a banned captain", async () => {
    const [cap, mate] = await Promise.all([createPlayer(), createPlayer()]);
    const m = await createMatch(admin.id, { mode: "DUO" });
    const team = await testDb().team.create({
      data: { game: "FREE_FIRE", name: "Alpha", captainId: cap.id },
    });
    const reg = await testDb().registration.create({
      data: { matchId: m.id, userId: cap.id, teamId: team.id, status: "CONFIRMED", position: 1 },
    });
    await testDb().registrationMember.createMany({
      data: [
        { registrationId: reg.id, matchId: m.id, userId: cap.id, status: "CONFIRMED" },
        { registrationId: reg.id, matchId: m.id, userId: mate.id, status: "CONFIRMED" },
      ],
    });
    await banUser(admin, { userId: cap.id, reason: "Cheating" });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe(
      "CANCELLED",
    );
    expect(await testDb().registrationMember.count({ where: { registrationId: reg.id } })).toBe(0);
  });
});

describe("merge", () => {
  it("moves payouts and the payout method, and refreshes active leaderboards", async () => {
    const [primary, dup] = await Promise.all([createPlayer(), createPlayer()]);
    const season = await activeSeasonWithPoints([[dup.id, 20]]);
    await testDb().leaderboardSnapshot.deleteMany();
    await testDb().payout.create({ data: { userId: dup.id, place: 1, amountPaise: 1000 } });
    await testDb().payoutMethod.create({
      data: {
        userId: dup.id,
        kind: "UPI",
        beneficiaryId: "ben_dup",
        accountHolderName: "Dup",
        vpaMasked: "d***@ok",
      },
    });
    const moved = await mergeUsers(admin, { primaryId: primary.id, duplicateId: dup.id });
    expect(moved).toMatchObject({ points: 1, payouts: 1, payoutMethod: true });
    expect(moved.refreshedSeasons).toEqual([season.id]);
    expect(await testDb().payout.count({ where: { userId: primary.id } })).toBe(1);
    expect(await testDb().payoutMethod.findUnique({ where: { userId: primary.id } })).not.toBeNull();
    expect(await board(season.id)).toEqual([primary.id]);
  });
});

describe("team admin side effects", () => {
  async function teamInMatch() {
    const [cap, mate, extra] = await Promise.all([createPlayer(), createPlayer(), createPlayer()]);
    const team = await testDb().team.create({
      data: {
        game: "FREE_FIRE",
        name: "Bravo",
        captainId: cap.id,
        members: {
          create: [cap, mate, extra].map((u) => ({
            userId: u.id,
            game: "FREE_FIRE" as const,
            status: "CONFIRMED" as const,
          })),
        },
      },
    });
    const upcoming = await createMatch(admin.id, { mode: "DUO" });
    const done = await createMatch(admin.id, { mode: "DUO", status: "COMPLETED" });
    const regs = [];
    for (const m of [upcoming, done]) {
      const reg = await testDb().registration.create({
        data: { matchId: m.id, userId: cap.id, teamId: team.id, status: "CONFIRMED", position: 1 },
      });
      await testDb().registrationMember.createMany({
        data: [cap, mate].map((u) => ({
          registrationId: reg.id,
          matchId: m.id,
          userId: u.id,
          status: "CONFIRMED" as const,
        })),
      });
      regs.push(reg);
    }
    return { cap, mate, extra, team, upcoming: regs[0]!, done: regs[1]! };
  }

  it("captain transfer moves upcoming registrations to the new captain only", async () => {
    const { mate, cap, team, upcoming, done } = await teamInMatch();
    await adminTransferCaptain(mod, { teamId: team.id, userId: mate.id });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: upcoming.id } })).userId).toBe(
      mate.id,
    );
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: done.id } })).userId).toBe(
      cap.id,
    );
  });

  it("removing a member takes them off the team's upcoming rosters", async () => {
    const { mate, team, upcoming, done } = await teamInMatch();
    await adminRemoveTeamMember(mod, { teamId: team.id, userId: mate.id });
    expect(
      await testDb().registrationMember.count({ where: { registrationId: upcoming.id, userId: mate.id } }),
    ).toBe(0);
    expect(
      await testDb().registrationMember.count({ where: { registrationId: done.id, userId: mate.id } }),
    ).toBe(1);
  });

  it("validates input", async () => {
    await expect(adminTransferCaptain(mod, { teamId: "" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(adminRemoveTeamMember(mod, {})).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
