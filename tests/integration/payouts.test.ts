import { beforeEach, describe, expect, it } from "vitest";
import { STUB_PAYOUT_WEBHOOK_SECRET } from "@/server/providers/payout-gateway";
import {
  addSeasonPrize,
  approvePayout,
  exportPayoutsCsv,
  markPayoutPaidManually,
  resolveReconciliationFlag,
  revealPayoutUpi,
  savePayoutMethod,
  setPayoutProgress,
  syncMatchPrizePayout,
  syncTournamentPayouts,
  syncTournamentPrizePayouts,
  voidPayout,
} from "@/server/services/payouts";
import { handlePayoutWebhook } from "@/server/services/webhooks";
import type { Actor } from "@/lib/roles";
import { signWebhook } from "@/lib/webhook-signature";
import {
  createMatch,
  createPlayer,
  createUser,
  resetDb,
  testDb,
} from "../helpers/db";

let admin: Actor;
let admin2: Actor;
const mod: Actor = { id: "mod", role: "MODERATOR" };
const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  admin2 = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  process.env.PAYOUT_TWO_STEP_THRESHOLD_PAISE = "500000";
});

function transferWebhook(type: string, transferId: string) {
  const body = JSON.stringify({
    data: {
      transfer_id: transferId,
      cf_transfer_id: "cf_tr_1",
      status: type.replace("TRANSFER_", ""),
    },
    event_time: "2026-09-27T17:43:37",
    type,
  });
  const ts = String(Date.now());
  return handlePayoutWebhook(body, signWebhook(STUB_PAYOUT_WEBHOOK_SECRET, ts, body), ts);
}

async function winnerWithMethod(prizePaise: number) {
  const w = await createPlayer("BGMI", { dateOfBirth: new Date("1999-01-01T00:00:00Z") });
  await savePayoutMethod(player(w), {
    kind: "UPI",
    accountHolderName: "Winner One",
    vpa: "winner@okaxis",
  });
  const t = await testDb().tournament.create({
    data: {
      game: "BGMI",
      title: "Cup",
      format: "LOBBY_POINTS",
      mode: "SQUAD",
      weekOf: new Date("2026-09-28"),
      startsAt: new Date("2026-10-01T14:30:00Z"),
      winners: [
        { place: 1, name: "Team", avatarUrl: null, prizePaise, userIds: [w.id], payeeUserId: w.id },
      ],
      winnersPublishedAt: new Date(),
    },
  });
  await syncTournamentPayouts(admin);
  return { w, t, payout: await testDb().payout.findFirstOrThrow({ where: { userId: w.id } }) };
}

describe("payout method", () => {
  it("requires login, an adult and a valid UPI/bank account; stores only masked details", async () => {
    await expect(savePayoutMethod(null, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const minor = await createPlayer("BGMI", {
      dateOfBirth: new Date(Date.now() - 15 * 365 * 86400_000),
    });
    await expect(
      savePayoutMethod(player(minor), {
        kind: "UPI",
        accountHolderName: "Kid Player",
        vpa: "kid@okaxis",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("guardian"),
    });
    const adult = await createPlayer("BGMI", { dateOfBirth: new Date("1995-05-05T00:00:00Z") });
    await expect(
      savePayoutMethod(player(adult), {
        kind: "UPI",
        accountHolderName: "Adult One",
        vpa: "not-a-vpa",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      savePayoutMethod(player(adult), {
        kind: "BANK",
        accountHolderName: "Adult One",
        accountNumber: "123456789012",
        ifsc: "BAD",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const saved = await savePayoutMethod(player(adult), {
      kind: "BANK",
      accountHolderName: "Adult One",
      accountNumber: "123456789012",
      ifsc: "hdfc0001234",
    });
    expect(saved).toMatchObject({
      kind: "BANK",
      accountLast4: "9012",
      ifsc: "HDFC0001234",
      vpaMasked: null,
    });
    expect(JSON.stringify(await testDb().payoutMethod.findMany())).not.toContain("123456789012");
  });

  it("keeps the full UPI ID for its owner to reveal, but never in the audit log or the return value", async () => {
    const adult = await createUser({ dateOfBirth: new Date("1995-01-01T00:00:00Z") });
    const saved = await savePayoutMethod(player(adult), {
      kind: "UPI",
      accountHolderName: "Adult Two",
      vpa: "adult.two@okaxis",
    });
    expect(saved).not.toHaveProperty("vpa");
    expect(saved.vpaMasked).not.toBe("adult.two@okaxis");
    const row = await testDb().payoutMethod.findUniqueOrThrow({ where: { userId: adult.id } });
    expect(row.vpa).toBe("adult.two@okaxis");
    const audit = await testDb().auditLog.findMany({ where: { action: "payoutMethod.save" } });
    expect(JSON.stringify(audit)).not.toContain("adult.two@okaxis");
  });
});

describe("payout ledger", () => {
  it("is admin-only", async () => {
    await expect(syncTournamentPayouts(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      markPayoutPaidManually(mod, { payoutId: "x", reference: "UTR123456" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(voidPayout(mod, { payoutId: "x", reason: "Disqualified" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(resolveReconciliationFlag(mod, { flagId: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(exportPayoutsCsv(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(markPayoutPaidManually(null, {})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(approvePayout(mod, { payoutId: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      addSeasonPrize(mod, { seasonId: "s", place: 1, amount: "100" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("builds rows from published winners once", async () => {
    const { w } = await winnerWithMethod(150000);
    expect(await syncTournamentPayouts(admin)).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(await testDb().payout.count({ where: { userId: w.id } })).toBe(1);
  });

  it("adds season prizes for archived champions", async () => {
    const w = await createPlayer();
    const s = await testDb().season.create({
      data: {
        game: "FREE_FIRE",
        name: "S1",
        startsAt: new Date("2026-06-01"),
        endsAt: new Date("2026-09-01"),
        isActive: false,
      },
    });
    await expect(
      addSeasonPrize(admin, { seasonId: s.id, place: 1, amount: "1000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await testDb().seasonResult.create({
      data: { seasonId: s.id, userId: w.id, rank: 1, points: 90 },
    });
    const p = await addSeasonPrize(admin, { seasonId: s.id, place: 1, amount: "1000" });
    expect(p).toMatchObject({ amountPaise: 100000, userId: w.id, status: "PENDING" });
    await expect(
      addSeasonPrize(admin, { seasonId: s.id, place: 1, amount: "1000" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a sandbox payout is marked SUCCESS via webhook, and replays never pay twice", async () => {
    const { payout } = await winnerWithMethod(200000);
    expect(await approvePayout(admin, { payoutId: payout.id })).toBe("SENT");
    const sent = await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(sent).toMatchObject({ status: "PROCESSING", method: "UPI", approvedById: admin.id });
    expect(sent.transferId).toMatch(/^tr_/);
    // Approving again while in flight is refused (no second transfer).
    await expect(approvePayout(admin, { payoutId: payout.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect((await transferWebhook("TRANSFER_SUCCESS", sent.transferId!)).body.result).toBe(
      "SUCCESS",
    );
    expect((await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      "SUCCESS",
    );
    expect((await transferWebhook("TRANSFER_SUCCESS", sent.transferId!)).body.result).toBe(
      "DUPLICATE",
    );
    expect((await transferWebhook("TRANSFER_FAILED", sent.transferId!)).body.result).toBe(
      "IGNORED",
    );
    expect(await testDb().auditLog.count({ where: { action: "payout.success" } })).toBe(1);
  });

  it("rejects unsigned payout webhooks", async () => {
    const res = await handlePayoutWebhook(
      '{"type":"TRANSFER_SUCCESS","data":{"transfer_id":"x"}}',
      "bad",
      "1",
    );
    expect(res.status).toBe(401);
  });

  it("requires two different admins above the threshold", async () => {
    const { payout } = await winnerWithMethod(600000);
    expect(await approvePayout(admin, { payoutId: payout.id })).toBe("AWAITING_SECOND_APPROVAL");
    expect((await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      "PENDING",
    );
    await expect(approvePayout(admin, { payoutId: payout.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await approvePayout(admin2, { payoutId: payout.id })).toBe("SENT");
    expect(await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: "PROCESSING",
      approvedById: admin.id,
      secondApprovedById: admin2.id,
    });
  });

  it("cannot pay a winner without a payout method", async () => {
    const w = await createPlayer();
    const t = await testDb().tournament.create({
      data: {
        game: "BGMI",
        title: "Cup",
        format: "LOBBY_POINTS",
        mode: "SQUAD",
        weekOf: new Date("2026-09-28"),
        startsAt: new Date(),
        winners: [{ place: 1, name: "X", avatarUrl: null, prizePaise: 1000, userIds: [w.id] }],
        winnersPublishedAt: new Date(),
      },
    });
    await syncTournamentPayouts(admin);
    const p = await testDb().payout.findFirstOrThrow({ where: { tournamentId: t.id } });
    await expect(approvePayout(admin, { payoutId: p.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("re-syncs stale un-started tournament rows and leaves started ones alone", async () => {
    const { w, t, payout } = await winnerWithMethod(150000);
    const other = await createPlayer("BGMI");
    const third = await createPlayer("BGMI");
    // Podium edited: new payee for 1st, a new 2nd place.
    await testDb().tournament.update({
      where: { id: t.id },
      data: {
        winners: [
          { place: 1, name: "T", avatarUrl: null, prizePaise: 150000, userIds: [other.id] },
          { place: 2, name: "U", avatarUrl: null, prizePaise: 50000, userIds: [third.id] },
        ],
      },
    });
    expect(await syncTournamentPayouts(admin)).toEqual({ created: 2, updated: 0, removed: 1 });
    expect(await testDb().payout.findUnique({ where: { id: payout.id } })).toBeNull();
    // Amount change on an un-started row is applied.
    await testDb().tournament.update({
      where: { id: t.id },
      data: {
        winners: [
          { place: 1, name: "T", avatarUrl: null, prizePaise: 160000, userIds: [other.id] },
          { place: 2, name: "U", avatarUrl: null, prizePaise: 50000, userIds: [third.id] },
        ],
      },
    });
    expect(await syncTournamentPayouts(admin)).toEqual({ created: 0, updated: 1, removed: 0 });
    const first = await testDb().payout.findFirstOrThrow({ where: { userId: other.id } });
    expect(first.amountPaise).toBe(160000);
    // A paid row is never removed, even when winners are unpublished.
    await markPayoutPaidManually(admin, { payoutId: first.id, reference: "UTR998877" });
    await testDb().tournament.update({
      where: { id: t.id },
      data: { winners: [], winnersPublishedAt: null },
    });
    expect(await testDb().$transaction((tx) => syncTournamentPrizePayouts(tx, t.id))).toMatchObject({
      created: 0,
      updated: 0,
      removed: 1,
    });
    expect(await testDb().payout.findMany({ where: { tournamentId: t.id } })).toMatchObject([
      { id: first.id, status: "SUCCESS" },
    ]);
    expect(await testDb().payout.count({ where: { userId: w.id } })).toBe(0);
  });

  it("marks a payout paid by hand with a reference, audited and notified", async () => {
    const { w, payout } = await winnerWithMethod(150000);
    await expect(
      markPayoutPaidManually(admin, { payoutId: payout.id, reference: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await markPayoutPaidManually(admin, { payoutId: payout.id, reference: "UTR123456" });
    expect(await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: "SUCCESS",
      manualReference: "UTR123456",
    });
    expect(await testDb().auditLog.count({ where: { action: "payout.manualPaid" } })).toBe(1);
    expect(
      await testDb().notification.count({ where: { userId: w.id, type: "PAYOUT_STATUS" } }),
    ).toBe(1);
    await expect(
      markPayoutPaidManually(admin, { payoutId: payout.id, reference: "UTR123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(approvePayout(admin, { payoutId: payout.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("lets an admin reveal the winner's full UPI ID to pay by hand, audited without it (DECISIONS M32)", async () => {
    const { payout } = await winnerWithMethod(150000);
    await expect(revealPayoutUpi(mod, { payoutId: payout.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revealPayoutUpi(admin, {})).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await revealPayoutUpi(admin, { payoutId: payout.id })).toEqual({
      vpa: "winner@okaxis",
      name: "Winner One",
    });
    const audit = await testDb().auditLog.findMany({ where: { action: "payout.revealUpi" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("winner@okaxis");
    // Once paid, the UPI ID isn't shown any more.
    await markPayoutPaidManually(admin, { payoutId: payout.id, reference: "UTR777888" });
    await expect(revealPayoutUpi(admin, { payoutId: payout.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves a hand-paid prize Waiting → Processing → Confirmed (DECISIONS M26)", async () => {
    const { w, payout } = await winnerWithMethod(150000);
    await expect(setPayoutProgress(mod, { payoutId: payout.id, status: "PROCESSING" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setPayoutProgress(admin, { payoutId: payout.id, status: "SUCCESS" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await setPayoutProgress(admin, { payoutId: payout.id, status: "PROCESSING" });
    expect((await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("PROCESSING");
    expect(await testDb().notification.count({ where: { userId: w.id, type: "PAYOUT_STATUS" } })).toBe(1);
    // Back to waiting, then processing again, then confirmed with the reference.
    await setPayoutProgress(admin, { payoutId: payout.id, status: "PENDING" });
    await setPayoutProgress(admin, { payoutId: payout.id, status: "PROCESSING" });
    await markPayoutPaidManually(admin, { payoutId: payout.id, reference: "UTR555666" });
    expect(await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: "SUCCESS",
      manualReference: "UTR555666",
    });
    expect(await testDb().auditLog.count({ where: { action: "payout.manualStatus" } })).toBe(3);
    // A confirmed payout can't go back.
    await expect(setPayoutProgress(admin, { payoutId: payout.id, status: "PENDING" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("leaves a real Cashfree transfer's status to Cashfree", async () => {
    const { payout } = await winnerWithMethod(150000);
    await testDb().payout.update({
      where: { id: payout.id },
      data: { status: "PROCESSING", transferId: "tr_real_1", cfTransferId: "cf_tr_real_1" },
    });
    await expect(setPayoutProgress(admin, { payoutId: payout.id, status: "PENDING" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      markPayoutPaidManually(admin, { payoutId: payout.id, reference: "UTR123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("voids a payout: excluded from the ledger and never approvable", async () => {
    const { payout } = await winnerWithMethod(150000);
    await expect(voidPayout(admin, { payoutId: payout.id, reason: "" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await voidPayout(admin, { payoutId: payout.id, reason: "Disqualified for cheating" });
    const row = await testDb().payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidReason).toBe("Disqualified for cheating");
    await expect(approvePayout(admin, { payoutId: payout.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(voidPayout(admin, { payoutId: payout.id, reason: "Again" })).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    // Sync does not bring a voided prize back.
    await syncTournamentPayouts(admin);
    expect(await testDb().payout.count()).toBe(1);
    const csv = await exportPayoutsCsv(admin);
    expect(csv.csv.trim().split("\n")).toHaveLength(1);
    const all = await exportPayoutsCsv(admin, { includeVoided: true });
    expect(all.csv).toContain("Disqualified for cheating");
  });

  it("resolves reconciliation flags once", async () => {
    const flag = await testDb().reconciliationFlag.create({
      data: { kind: "payment", entityId: "p1", ours: "PAID", theirs: "FAILED" },
    });
    await expect(resolveReconciliationFlag(admin, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await resolveReconciliationFlag(admin, { flagId: flag.id });
    expect(
      (await testDb().reconciliationFlag.findUniqueOrThrow({ where: { id: flag.id } })).resolvedAt,
    ).not.toBeNull();
    await expect(resolveReconciliationFlag(admin, { flagId: flag.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("exports the ledger as escaped CSV", async () => {
    const w = await createPlayer("BGMI", { displayName: '=HYPERLINK("x"), "Ace"' });
    await testDb().payout.create({
      data: { userId: w.id, place: 1, amountPaise: 123456, manualReference: "a,b" },
    });
    const { filename, csv } = await exportPayoutsCsv(admin);
    expect(filename).toMatch(/^payouts-\d{4}-\d{2}-\d{2}\.csv$/);
    const [header, line] = csv.trim().split("\n");
    expect(header).toContain("amount_inr");
    expect(line).toContain('"\'=HYPERLINK(""x""), ""Ace"""');
    expect(line).toContain('"1234.56"');
    expect(line).toContain('"a,b"');
  });
});

describe("scrim prize payouts", () => {
  async function completedScrim(mode: "SOLO" | "ONE_V_ONE", prizePaise = 20000) {
    const m = await createMatch(admin.id, { mode, status: "COMPLETED" });
    await testDb().match.update({ where: { id: m.id }, data: { prizePaise } });
    const [a, b] = await Promise.all([createPlayer(), createPlayer()]);
    const ra = await testDb().registration.create({
      data: { matchId: m.id, userId: a.id, status: "CONFIRMED", position: 1 },
    });
    const rb = await testDb().registration.create({
      data: { matchId: m.id, userId: b.id, status: "CONFIRMED", position: 2 },
    });
    return { m, a, b, ra, rb };
  }
  const sync = (matchId: string) =>
    testDb().$transaction((tx) => syncMatchPrizePayout(tx, matchId, null));

  it("creates one PENDING payout for the lobby winner (placement 1) and follows corrections", async () => {
    const { m, a, b, ra, rb } = await completedScrim("SOLO");
    await testDb().result.createMany({
      data: [
        { matchId: m.id, registrationId: ra.id, userId: a.id, placement: 1, kills: 3 },
        { matchId: m.id, registrationId: rb.id, userId: b.id, placement: 2, kills: 5 },
      ],
    });
    expect(await sync(m.id)).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(await sync(m.id)).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(await testDb().payout.findFirstOrThrow({ where: { matchId: m.id } })).toMatchObject({
      userId: a.id,
      place: 1,
      amountPaise: 20000,
      status: "PENDING",
    });
    // Results corrected: b actually won.
    await testDb().result.updateMany({ where: { registrationId: ra.id }, data: { placement: 2 } });
    await testDb().result.updateMany({ where: { registrationId: rb.id }, data: { placement: 1 } });
    expect(await sync(m.id)).toMatchObject({ created: 1, updated: 0, removed: 1 });
    expect((await testDb().payout.findMany({ where: { matchId: m.id } })).map((p) => p.userId)).toEqual([
      b.id,
    ]);
  });

  it("pays the head-to-head winner and skips tournament or prize-less matches", async () => {
    const { m, b, ra, rb } = await completedScrim("ONE_V_ONE");
    await testDb().result.createMany({
      data: [
        { matchId: m.id, registrationId: ra.id, won: false },
        { matchId: m.id, registrationId: rb.id, won: true },
      ],
    });
    await sync(m.id);
    expect((await testDb().payout.findFirstOrThrow({ where: { matchId: m.id } })).userId).toBe(b.id);
    // Prize removed (or match reopened): the un-started row goes away.
    await testDb().match.update({ where: { id: m.id }, data: { status: "RESULTS_PENDING" } });
    expect(await sync(m.id)).toMatchObject({ created: 0, updated: 0, removed: 1 });
    const free = await completedScrim("SOLO", 0);
    await testDb().result.create({
      data: { matchId: free.m.id, registrationId: free.ra.id, placement: 1, kills: 0 },
    });
    await sync(free.m.id);
    expect(await testDb().payout.count({ where: { matchId: free.m.id } })).toBe(0);
  });
});
