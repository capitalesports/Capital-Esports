import { beforeEach, describe, expect, it } from "vitest";
import { GET as cronGET } from "@/app/api/cron/match-status/route";
import { runMatchStatusJob } from "@/server/jobs/match-status-job";
import { addMinutes } from "@/lib/time";
import { createUser, resetDb, testDb } from "../helpers/db";

let adminId: string;
const START = new Date("2030-01-10T15:30:00Z");

async function makeMatch(game: "FREE_FIRE" | "BGMI" | "VALORANT" = "BGMI", minSlots = 0) {
  return testDb().match.create({
    data: {
      game,
      mode: game === "VALORANT" ? "FIVE_V_FIVE" : "SQUAD",
      title: "Cron test",
      startsAt: START,
      registrationOpensAt: addMinutes(START, -600),
      registrationClosesAt: addMinutes(START, -30),
      maxSlots: game === "VALORANT" ? 2 : 10,
      minSlots,
      status: "UPCOMING",
      createdById: adminId,
    },
  });
}

async function confirmed(matchId: string, paidPaise = 0) {
  const user = await createUser();
  const reg = await testDb().registration.create({
    data: { matchId, userId: user.id, status: "CONFIRMED", position: 1 },
  });
  if (paidPaise) {
    const p = await testDb().payment.create({
      data: {
        userId: user.id,
        matchId,
        registrationId: reg.id,
        orderId: `ord_${reg.id}`,
        amountPaise: paidPaise,
        status: "PAID",
        paidAt: START,
        expiresAt: START,
      },
    });
    await testDb().registration.update({ where: { id: reg.id }, data: { paymentId: p.id } });
  }
  return { user, reg };
}

const statusOf = async (id: string) => (await testDb().match.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  await resetDb();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

describe("match status cron job", () => {
  it("moves a test match through every time-driven state", async () => {
    const m = await makeMatch("BGMI");
    expect(await runMatchStatusJob(addMinutes(START, -601))).toEqual([]);
    expect(await statusOf(m.id)).toBe("UPCOMING");

    await runMatchStatusJob(addMinutes(START, -600));
    expect(await statusOf(m.id)).toBe("REGISTRATION_OPEN");

    await runMatchStatusJob(addMinutes(START, -30));
    expect(await statusOf(m.id)).toBe("REGISTRATION_CLOSED");

    await runMatchStatusJob(START);
    expect(await statusOf(m.id)).toBe("LIVE");

    await runMatchStatusJob(addMinutes(START, 29));
    expect(await statusOf(m.id)).toBe("LIVE");
    await runMatchStatusJob(addMinutes(START, 30)); // BGMI = 30 min
    expect(await statusOf(m.id)).toBe("RESULTS_PENDING");

    // Moderators complete results; cron never touches RESULTS_PENDING.
    expect(await runMatchStatusJob(addMinutes(START, 600))).toEqual([]);
    const audit = await testDb().auditLog.findMany({ where: { entityId: m.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorId])).toEqual([
      ["match.status.auto", null],
      ["match.status.auto", null],
      ["match.status.auto", null],
      ["match.status.auto", null],
    ]);
  });

  it("catches up an overdue match in one run, one audited step at a time", async () => {
    const m = await makeMatch("FREE_FIRE");
    const applied = await runMatchStatusJob(addMinutes(START, 25));
    expect(applied.map((t) => t.to)).toEqual(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE", "RESULTS_PENDING"]);
    expect(await statusOf(m.id)).toBe("RESULTS_PENDING");
    expect(await testDb().auditLog.count({ where: { entityId: m.id } })).toBe(4);
  });

  it("is idempotent when run twice", async () => {
    const m = await makeMatch();
    const now = addMinutes(START, 5);
    const first = await runMatchStatusJob(now);
    const second = await runMatchStatusJob(now);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(await statusOf(m.id)).toBe("LIVE");
    expect(await testDb().auditLog.count({ where: { entityId: m.id } })).toBe(first.length);
  });

  it("applies each transition exactly once when runs overlap", async () => {
    const matches = await Promise.all([makeMatch(), makeMatch(), makeMatch("VALORANT")]);
    const now = addMinutes(START, 1);
    const [a, b] = await Promise.all([runMatchStatusJob(now), runMatchStatusJob(now)]);
    for (const m of matches) {
      expect(await statusOf(m.id)).toBe("LIVE");
      // UPCOMING -> OPEN -> CLOSED -> LIVE: three audited steps per match, never duplicated.
      expect(await testDb().auditLog.count({ where: { entityId: m.id } })).toBe(3);
    }
    expect(a.length + b.length).toBe(9);
  });

  it("does not open matches without an automatic open time", async () => {
    const m = await makeMatch();
    await testDb().match.update({ where: { id: m.id }, data: { registrationOpensAt: null } });
    await runMatchStatusJob(addMinutes(START, -100));
    expect(await statusOf(m.id)).toBe("UPCOMING");
  });
});

describe("minimum slots and result reminders", () => {
  it("cancels a match with too few confirmed entries when registration closes, refunding and notifying", async () => {
    const m = await makeMatch("BGMI", 2);
    await testDb().match.update({ where: { id: m.id }, data: { entryFeePaise: 5000 } });
    const { user, reg } = await confirmed(m.id, 5000);
    const applied = await runMatchStatusJob(addMinutes(START, -30));
    expect(applied.map((t) => t.to)).toEqual(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CANCELLED"]);
    const row = await testDb().match.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: "CANCELLED", cancelReason: "Not enough players" });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe("CANCELLED");
    const pay = await testDb().payment.findFirstOrThrow({ where: { registrationId: reg.id } });
    expect(["REFUND_PENDING", "REFUNDED"]).toContain(pay.status);
    expect(await testDb().notification.count({ where: { userId: user.id, type: "MATCH_CANCELLED" } })).toBe(1);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "match.cancel.auto" } });
    expect(audit.actorId).toBeNull();
    // Rerun: nothing more happens.
    expect(await runMatchStatusJob(addMinutes(START, 60))).toEqual([]);
  });

  it("keeps a match that reached its minimum", async () => {
    const m = await makeMatch("BGMI", 1);
    await confirmed(m.id);
    await runMatchStatusJob(addMinutes(START, -30));
    expect(await statusOf(m.id)).toBe("REGISTRATION_CLOSED");
  });

  it("cancels a never-opened match past its close time, but never sign-up lists or bracket matches", async () => {
    const [manual, entry, bracket] = await Promise.all([makeMatch("BGMI", 2), makeMatch("BGMI", 2), makeMatch("VALORANT", 2)]);
    await testDb().match.updateMany({ where: { id: { in: [manual.id, entry.id, bracket.id] } }, data: { registrationOpensAt: null } });
    await testDb().match.update({ where: { id: entry.id }, data: { isEntryList: true } });
    await testDb().match.update({ where: { id: bracket.id }, data: { bracketRound: 1, bracketIndex: 0 } });
    await runMatchStatusJob(addMinutes(START, -20));
    expect(await statusOf(manual.id)).toBe("CANCELLED");
    expect(await statusOf(entry.id)).toBe("UPCOMING");
    expect(await statusOf(bracket.id)).toBe("UPCOMING");
  });

  it("asks confirmed registrants to submit results when the match leaves LIVE", async () => {
    const m = await makeMatch("BGMI");
    const { user } = await confirmed(m.id);
    await runMatchStatusJob(START);
    expect(await testDb().notification.count({ where: { type: "RESULTS_OPEN" } })).toBe(0);
    await runMatchStatusJob(addMinutes(START, 30));
    const notes = await testDb().notification.findMany({ where: { type: "RESULTS_OPEN" } });
    expect(notes.map((n) => [n.userId, n.url])).toEqual([[user.id, `/scrims/${m.id}`]]);
  });
});

describe("GET /api/cron/match-status", () => {
  it("requires the cron secret", async () => {
    process.env.CRON_SECRET = "cron-secret-for-tests";
    const res = await cronGET(new Request("http://localhost/api/cron/match-status"));
    expect(res.status).toBe(401);
    const wrong = await cronGET(
      new Request("http://localhost/api/cron/match-status", { headers: { authorization: "Bearer nope" } }),
    );
    expect(wrong.status).toBe(401);
    const ok = await cronGET(
      new Request("http://localhost/api/cron/match-status", { headers: { authorization: "Bearer cron-secret-for-tests" } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronGET(new Request("http://localhost/api/cron/match-status", { headers: { authorization: "Bearer undefined" } }));
    expect(res.status).toBe(401);
  });
});
