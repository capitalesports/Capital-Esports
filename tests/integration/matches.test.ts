import { beforeEach, describe, expect, it } from "vitest";
import {
  bulkCloneMatch,
  cancelMatch,
  cloneMatch,
  createMatch,
  deleteMatch,
  setRoomCredentials,
  transitionMatchStatus,
  updateMatch,
} from "@/server/services/matches";
import type { Actor } from "@/lib/roles";
import { addDays, utcToIstInput } from "@/lib/time";
import { createMatch as createMatchRow, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
let mod: Actor;
let player: Actor;

function futureIst(daysAhead = 1, hh = "21:00") {
  const d = addDays(new Date(), daysAhead);
  return `${utcToIstInput(d).slice(0, 10)}T${hh}`;
}

const form = () => ({
  game: "BGMI",
  kind: "SCRIM",
  mode: "SQUAD",
  title: "Night Scrim",
  startsAt: futureIst(),
  closeOffsetMinutes: "30",
  entryFee: "0",
  prize: "250",
});

beforeEach(async () => {
  await resetDb();
  const [a, m, p] = await Promise.all([
    createUser({ role: "ADMIN" }),
    createUser({ role: "MODERATOR" }),
    createUser(),
  ]);
  admin = { id: a.id, role: "ADMIN" };
  mod = { id: m.id, role: "MODERATOR" };
  player = { id: p.id, role: "PLAYER" };
});

async function auditActions(entityId: string) {
  return (
    await testDb().auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } })
  ).map((a) => a.action);
}

describe("role checks on every match mutation", () => {
  const calls: [string, (a: Actor | null) => Promise<unknown>][] = [
    ["createMatch", (a) => createMatch(a, form())],
    ["updateMatch", (a) => updateMatch(a, "x", form())],
    ["cloneMatch", (a) => cloneMatch(a, { matchId: "x", startsAt: futureIst(2) })],
    ["bulkCloneMatch", (a) => bulkCloneMatch(a, { matchId: "x", days: 3 })],
    [
      "transitionMatchStatus",
      (a) => transitionMatchStatus(a, { matchId: "x", to: "REGISTRATION_OPEN" }),
    ],
    [
      "setRoomCredentials",
      (a) => setRoomCredentials(a, { matchId: "x", roomId: "1", roomPassword: "2" }),
    ],
    ["cancelMatch", (a) => cancelMatch(a, { matchId: "x", reason: "Because" })],
  ];

  it.each(calls)("%s rejects anonymous and players", async (_name, call) => {
    await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(call(player)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("deleteMatch", () => {
  it("is admin-only and validates input", async () => {
    await expect(deleteMatch(null, { matchId: "x" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(deleteMatch(player, { matchId: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteMatch(mod, { matchId: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteMatch(admin, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(deleteMatch(admin, { matchId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes an empty match (audited, credentials redacted)", async () => {
    const empty = await createMatchRow(admin.id, { status: "RESULTS_PENDING" });
    await testDb().match.update({ where: { id: empty.id }, data: { roomId: "123", roomPassword: "secret" } });
    await deleteMatch(admin, { matchId: empty.id });
    expect(await testDb().match.findUnique({ where: { id: empty.id } })).toBeNull();
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: empty.id, action: "match.delete" } });
    expect(JSON.stringify(audit.before)).not.toContain("secret");
  });

  it("deletes a played match with its registrations, gives back no-show strikes and voids a pending prize (DECISIONS M25)", async () => {
    const played = await createMatchRow(admin.id, { status: "COMPLETED" });
    const [winner, absent] = await Promise.all([createUser(), createUser()]);
    await testDb().user.update({ where: { id: absent.id }, data: { strikes: 1 } });
    await testDb().registration.createMany({
      data: [
        { matchId: played.id, userId: winner.id, status: "CONFIRMED", position: 1 },
        { matchId: played.id, userId: absent.id, status: "NO_SHOW", position: 2 },
      ],
    });
    const prize = await testDb().payout.create({
      data: { userId: winner.id, matchId: played.id, place: 1, amountPaise: 10_000 },
    });
    await deleteMatch(admin, { matchId: played.id });
    expect(await testDb().match.findUnique({ where: { id: played.id } })).toBeNull();
    expect(await testDb().registration.count({ where: { matchId: played.id } })).toBe(0);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: absent.id } })).strikes).toBe(0);
    expect((await testDb().payout.findUniqueOrThrow({ where: { id: prize.id } })).voidReason).toBe("Match deleted");
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: played.id, action: "match.delete" } });
    expect(audit.after).toMatchObject({ registrations: 2, noShowsRestored: 1, payoutsVoided: 1 });
  });

  it("refuses a match with paid entry fees or a prize already being paid", async () => {
    const paid = await createMatchRow(admin.id, { status: "REGISTRATION_OPEN", entryFeePaise: 5000 });
    const p = await createUser();
    const reg = await testDb().registration.create({ data: { matchId: paid.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    await testDb().payment.create({
      data: { userId: p.id, matchId: paid.id, registrationId: reg.id, orderId: `o-${reg.id}`, amountPaise: 5000, status: "PAID", expiresAt: new Date() },
    });
    await expect(deleteMatch(admin, { matchId: paid.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await testDb().match.findUnique({ where: { id: paid.id } })).not.toBeNull();

    const prized = await createMatchRow(admin.id, { status: "COMPLETED" });
    await testDb().payout.create({
      data: { userId: p.id, matchId: prized.id, place: 1, amountPaise: 10_000, status: "SUCCESS" },
    });
    await expect(deleteMatch(admin, { matchId: prized.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("createMatch / updateMatch", () => {
  it("validates on the server", async () => {
    await expect(createMatch(mod, { ...form(), mode: "FIVE_V_FIVE" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(createMatch(mod, { ...form(), entryFee: "abc" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(createMatch(mod, { ...form(), minSlots: "99" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("takes the capacity from the game and mode (no max field)", async () => {
    expect((await createMatch(mod, form())).maxSlots).toBe(25);
    expect((await createMatch(mod, { ...form(), mode: "TWO_V_TWO", maxSlots: "40" })).maxSlots).toBe(2);
  });

  it("creates an UPCOMING match stored in UTC with an audit row", async () => {
    const m = await createMatch(mod, form());
    expect(m.status).toBe("UPCOMING");
    expect(m.prizePaise).toBe(25000);
    expect(utcToIstInput(m.startsAt)).toBe(form().startsAt);
    expect(await auditActions(m.id)).toEqual(["match.create"]);
  });

  it("rejects a tournament link for another game", async () => {
    const t = await testDb().tournament.create({
      data: {
        game: "VALORANT",
        weekOf: new Date("2026-09-28"),
        startsAt: new Date("2026-10-01T14:30:00Z"),
        title: "Val Cup",
        format: "BRACKET",
        mode: "FIVE_V_FIVE",
      },
    });
    await expect(createMatch(admin, { ...form(), tournamentId: t.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("updates editable matches (audited)", async () => {
    const m = await createMatch(admin, form());
    await testDb().registration.createMany({
      data: await Promise.all(
        [1, 2, 3].map(async (i) => ({
          matchId: m.id,
          userId: (await createUser()).id,
          status: "CONFIRMED" as const,
          position: i,
        })),
      ),
    });
    const updated = await updateMatch(admin, m.id, { ...form(), title: "Renamed" });
    expect(updated.title).toBe("Renamed");
    expect(await auditActions(m.id)).toEqual(["match.create", "match.update"]);
  });

  it("refuses editing a live match", async () => {
    const m = await createMatchRow(admin.id, { status: "LIVE" });
    await expect(updateMatch(admin, m.id, form())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("cloning", () => {
  it("clones to another date keeping schedule offsets, without room credentials", async () => {
    const src = await createMatch(admin, { ...form(), registrationOpensAt: futureIst(1, "09:00") });
    await setRoomCredentials(admin, { matchId: src.id, roomId: "R1", roomPassword: "P1" });
    const clone = await cloneMatch(admin, { matchId: src.id, startsAt: futureIst(3, "18:00") });
    expect(utcToIstInput(clone.startsAt)).toBe(futureIst(3, "18:00"));
    expect(clone.startsAt.getTime() - clone.registrationClosesAt.getTime()).toBe(30 * 60_000);
    expect(clone.startsAt.getTime() - clone.registrationOpensAt!.getTime()).toBe(12 * 3600_000);
    expect(clone.roomId).toBeNull();
    expect(clone.status).toBe("UPCOMING");
    expect(await auditActions(clone.id)).toEqual(["match.clone"]);
  });

  it("refuses cloning into the past", async () => {
    const src = await createMatch(admin, form());
    await expect(
      cloneMatch(admin, { matchId: src.id, startsAt: "2020-01-01T10:00" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("bulk clones the same match daily for N days", async () => {
    const src = await createMatch(admin, form());
    const clones = await bulkCloneMatch(admin, { matchId: src.id, days: 3 });
    expect(clones).toHaveLength(3);
    clones.forEach((c, i) =>
      expect(c.startsAt.getTime()).toBe(addDays(src.startsAt, i + 1).getTime()),
    );
    await expect(bulkCloneMatch(admin, { matchId: src.id, days: 30 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("status controls", () => {
  it("applies legal transitions with audit rows and rejects illegal ones", async () => {
    const m = await createMatch(mod, form());
    await transitionMatchStatus(mod, { matchId: m.id, to: "REGISTRATION_OPEN" });
    await expect(transitionMatchStatus(mod, { matchId: m.id, to: "LIVE" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await transitionMatchStatus(mod, { matchId: m.id, to: "REGISTRATION_CLOSED" });
    await transitionMatchStatus(mod, { matchId: m.id, to: "LIVE" });
    await transitionMatchStatus(mod, { matchId: m.id, to: "RESULTS_PENDING" });
    expect((await testDb().match.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      "RESULTS_PENDING",
    );
    expect(await auditActions(m.id)).toEqual([
      "match.create",
      "match.status",
      "match.status",
      "match.status",
      "match.status",
    ]);
  });

  it("does not allow completing or cancelling through the generic status control", async () => {
    const m = await createMatchRow(admin.id, { status: "RESULTS_PENDING" });
    await expect(
      transitionMatchStatus(admin, { matchId: m.id, to: "COMPLETED" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      transitionMatchStatus(admin, { matchId: m.id, to: "CANCELLED" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("sets room credentials without writing them to the audit log", async () => {
    const m = await createMatchRow(admin.id, { status: "REGISTRATION_OPEN" });
    await expect(
      setRoomCredentials(mod, { matchId: m.id, roomId: "", roomPassword: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await setRoomCredentials(mod, { matchId: m.id, roomId: "98765", roomPassword: "s3cret" });
    const row = await testDb().match.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ roomId: "98765", roomPassword: "s3cret" });
    const audit = await testDb().auditLog.findFirstOrThrow({
      where: { entityId: m.id, action: "match.roomCredentials" },
    });
    expect(JSON.stringify(audit)).not.toContain("s3cret");
    expect(JSON.stringify(audit)).not.toContain("98765");
  });

  it("needs a password for Free Fire / BGMI but only a room code for Valorant (DECISIONS M22)", async () => {
    const ff = await createMatchRow(admin.id, { status: "REGISTRATION_OPEN", game: "FREE_FIRE" });
    await expect(setRoomCredentials(mod, { matchId: ff.id, roomId: "111" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { roomPassword: expect.any(Array) },
    });
    const val = await createMatchRow(admin.id, { status: "REGISTRATION_OPEN", game: "VALORANT", mode: "FIVE_V_FIVE" });
    await setRoomCredentials(mod, { matchId: val.id, roomId: "PARTY-7788", roomPassword: "ignored" });
    expect(await testDb().match.findUniqueOrThrow({ where: { id: val.id } })).toMatchObject({
      roomId: "PARTY-7788",
      roomPassword: null,
    });
  });

  it("cancels with a reason, cancels every registration and audits", async () => {
    const m = await createMatchRow(admin.id, { status: "REGISTRATION_OPEN" });
    const users = await Promise.all([createUser(), createUser()]);
    await testDb().registration.createMany({
      data: [
        { matchId: m.id, userId: users[0]!.id, status: "CONFIRMED", position: 1 },
        { matchId: m.id, userId: users[1]!.id, status: "WAITLISTED", position: 2 },
      ],
    });
    await expect(cancelMatch(admin, { matchId: m.id, reason: "" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const result = await cancelMatch(admin, { matchId: m.id, reason: "Not enough players" });
    expect(result).toEqual({ cancelledRegistrations: 2, refundsQueued: 0 });
    const regs = await testDb().registration.findMany({ where: { matchId: m.id } });
    expect(regs.every((r) => r.status === "CANCELLED" && r.cancelledAt)).toBe(true);
    const row = await testDb().match.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: "CANCELLED", cancelReason: "Not enough players" });
    expect(await auditActions(m.id)).toContain("match.cancel");
    await expect(cancelMatch(admin, { matchId: m.id, reason: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("cancels a live match too, refunding paid entries and notifying every player", async () => {
    const m = await createMatchRow(admin.id, { status: "LIVE", entryFeePaise: 5000, mode: "DUO" });
    const [captain, mate, solo] = await Promise.all([createUser(), createUser(), createUser()]);
    const reg = await paidRegistration(m.id, captain.id, 1);
    await testDb().registrationMember.create({
      data: { registrationId: reg.id, matchId: m.id, userId: mate.id, status: "CONFIRMED" },
    });
    await testDb().registration.create({
      data: { matchId: m.id, userId: solo.id, status: "CANCELLED", position: 2 },
    });
    const result = await cancelMatch(admin, { matchId: m.id, reason: "Server outage" });
    expect(result).toEqual({ cancelledRegistrations: 1, refundsQueued: 1 });
    const pay = await testDb().payment.findFirstOrThrow({ where: { registrationId: reg.id } });
    expect(["REFUND_PENDING", "REFUNDED"]).toContain(pay.status);
    const notes = await testDb().notification.findMany({ where: { type: "MATCH_CANCELLED" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([captain.id, mate.id].sort());
    expect(notes[0]!.body).toContain("Server outage");
  });

  it("asks confirmed registrants to submit results when a live match ends", async () => {
    const m = await createMatchRow(admin.id, { status: "LIVE" });
    const [a, b] = await Promise.all([createUser(), createUser()]);
    await testDb().registration.createMany({
      data: [
        { matchId: m.id, userId: a.id, status: "CONFIRMED", position: 1 },
        { matchId: m.id, userId: b.id, status: "WAITLISTED", position: 2 },
      ],
    });
    await transitionMatchStatus(mod, { matchId: m.id, to: "RESULTS_PENDING" });
    const notes = await testDb().notification.findMany({ where: { type: "RESULTS_OPEN" } });
    expect(notes.map((n) => [n.userId, n.url])).toEqual([[a.id, `/scrims/${m.id}`]]);
  });
});

async function paidRegistration(matchId: string, userId: string, position: number) {
  const reg = await testDb().registration.create({
    data: { matchId, userId, status: "CONFIRMED", position },
  });
  const payment = await testDb().payment.create({
    data: {
      userId,
      matchId,
      registrationId: reg.id,
      orderId: `ord_${reg.id}`,
      amountPaise: 5000,
      status: "PAID",
      paidAt: new Date(),
      expiresAt: addDays(new Date(), 1),
    },
  });
  return testDb().registration.update({ where: { id: reg.id }, data: { paymentId: payment.id } });
}

let weekSeq = 0;
async function tournament(data: {
  game?: "BGMI" | "VALORANT";
  mode?: "SQUAD" | "DUO" | "FIVE_V_FIVE";
  format?: "BRACKET" | "LOBBY_POINTS";
  cancelledAt?: Date;
}) {
  return testDb().tournament.create({
    data: {
      game: data.game ?? "BGMI",
      mode: data.mode ?? "SQUAD",
      format: data.format ?? "LOBBY_POINTS",
      cancelledAt: data.cancelledAt,
      weekOf: new Date(Date.UTC(2026, 9, 5 + 7 * weekSeq++)),
      startsAt: new Date("2026-10-01T14:30:00Z"),
      title: "Cup",
    },
  });
}

describe("tournament links, cloning limits and locked fields", () => {
  it("links only to a non-cancelled lobby tournament of the same game and mode", async () => {
    const squad = await tournament({ mode: "SQUAD" });
    const duo = await tournament({ mode: "DUO" });
    const cancelled = await tournament({ mode: "SQUAD", cancelledAt: new Date() });
    const bracket = await tournament({ game: "BGMI", mode: "SQUAD", format: "BRACKET" });
    for (const t of [duo, cancelled, bracket]) {
      await expect(
        createMatch(admin, { ...form(), kind: "TOURNAMENT", tournamentId: t.id }),
      ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { tournamentId: expect.any(Array) } });
    }
    const m = await createMatch(admin, { ...form(), kind: "TOURNAMENT", tournamentId: squad.id });
    expect(m.tournamentId).toBe(squad.id);
  });

  it("refuses cloning tournament matches, bracket matches and sign-up lists", async () => {
    const t = await tournament({});
    const linked = await createMatchRow(admin.id, { tournamentId: t.id, kind: "TOURNAMENT" });
    const bracket = await testDb().match.update({
      where: { id: (await createMatchRow(admin.id)).id },
      data: { bracketRound: 1, bracketIndex: 0 },
    });
    const entry = await testDb().match.update({
      where: { id: (await createMatchRow(admin.id)).id },
      data: { isEntryList: true },
    });
    for (const src of [linked, bracket, entry]) {
      await expect(
        cloneMatch(admin, { matchId: src.id, startsAt: futureIst(3, "18:00") }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(bulkCloneMatch(admin, { matchId: src.id, days: 2 })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    }
  });

  it("locks game, mode and kind once anyone registered", async () => {
    const m = await createMatch(admin, form());
    await testDb().registration.create({
      data: { matchId: m.id, userId: (await createUser()).id, status: "WAITLISTED", position: 1 },
    });
    await expect(updateMatch(admin, m.id, { ...form(), mode: "DUO" })).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { mode: expect.any(Array) },
    });
    await expect(
      updateMatch(admin, m.id, { ...form(), game: "FREE_FIRE" }),
    ).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { game: expect.any(Array) } });
    await expect(
      updateMatch(admin, m.id, { ...form(), kind: "TOURNAMENT", tournamentId: "t" }),
    ).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { kind: expect.any(Array) } });
    const ok = await updateMatch(admin, m.id, { ...form(), title: "Still editable" });
    expect(ok.title).toBe("Still editable");
  });

  it("stores minimum slots and validates them against a full lobby", async () => {
    const m = await createMatch(admin, { ...form(), minSlots: "8" });
    expect(m.minSlots).toBe(8);
    await expect(createMatch(admin, { ...form(), minSlots: "26" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { minSlots: expect.any(Array) },
    });
  });
});
