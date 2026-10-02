import { beforeEach, describe, expect, it } from "vitest";
import { transitionMatchStatus } from "@/server/services/matches";
import { registerForMatch } from "@/server/services/registration";
import type { Actor } from "@/lib/roles";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

/** `n` confirmed solo entries on a match, in sign-up order. */
async function fill(matchId: string, n: number, game: "FREE_FIRE" | "VALORANT" = "FREE_FIRE") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = await createPlayer(game);
    await testDb().registration.create({
      data: { matchId, userId: p.id, status: "CONFIRMED", position: i + 1 },
    });
    ids.push(p.id);
  }
  return ids;
}

const lobbiesOf = (parentId: string) =>
  testDb().match.findMany({
    where: { OR: [{ id: parentId }, { parentMatchId: parentId }] },
    orderBy: { lobbyNumber: "asc" },
    include: { _count: { select: { registrations: { where: { status: "CONFIRMED" } } } } },
  });

describe("open entry", () => {
  it("never fills a standalone scrim: registrations past the lobby size are confirmed, not waitlisted", async () => {
    const m = await createMatch(admin.id, { game: "FREE_FIRE", mode: "SOLO", maxSlots: 2 });
    for (let i = 0; i < 4; i++) {
      const r = await registerForMatch(player(await createPlayer("FREE_FIRE")), { matchId: m.id });
      expect(r.status).toBe("CONFIRMED");
    }
  });

  it("keeps the capacity for tournament matches", async () => {
    const t = await testDb().tournament.create({
      data: { game: "FREE_FIRE", mode: "SOLO", format: "LOBBY_POINTS", title: "Cup", weekOf: new Date("2026-09-28"), startsAt: new Date() },
    });
    const m = await createMatch(admin.id, { game: "FREE_FIRE", mode: "SOLO", maxSlots: 1, kind: "TOURNAMENT", tournamentId: t.id });
    expect((await registerForMatch(player(await createPlayer()), { matchId: m.id })).status).toBe("CONFIRMED");
    expect((await registerForMatch(player(await createPlayer()), { matchId: m.id })).status).toBe("WAITLISTED");
  });
});

describe("splitting into lobbies when registration closes", () => {
  it("leaves a scrim that fits in one lobby alone", async () => {
    const m = await createMatch(admin.id, { game: "FREE_FIRE", mode: "SOLO", maxSlots: 48 });
    await fill(m.id, 30);
    await transitionMatchStatus(admin, { matchId: m.id, to: "REGISTRATION_CLOSED" });
    const lobbies = await lobbiesOf(m.id);
    expect(lobbies).toHaveLength(1);
    expect(lobbies[0]!.lobbyNumber).toBeNull();
  });

  it("opens balanced extra lobbies in sign-up order, each its own match, and tells every player", async () => {
    const m = await createMatch(admin.id, { game: "FREE_FIRE", mode: "SOLO", maxSlots: 48, title: "FF Solo Rush" });
    await testDb().match.update({ where: { id: m.id }, data: { prizePaise: 50_000, roomId: "R1", roomPassword: "P1" } });
    const players = await fill(m.id, 50);
    await transitionMatchStatus(admin, { matchId: m.id, to: "REGISTRATION_CLOSED" });

    const lobbies = await lobbiesOf(m.id);
    expect(lobbies.map((l) => [l.lobbyNumber, l._count.registrations])).toEqual([
      [1, 25],
      [2, 25],
    ]);
    const second = lobbies[1]!;
    expect(second).toMatchObject({
      title: "FF Solo Rush — Lobby 2",
      parentMatchId: m.id,
      status: "REGISTRATION_CLOSED",
      prizePaise: 50_000,
      roomId: null,
      minSlots: 0,
    });
    const movedFirst = await testDb().registration.findFirstOrThrow({ where: { userId: players[25]! } });
    expect(movedFirst).toMatchObject({ matchId: second.id, position: 1 });
    expect(await testDb().registration.count({ where: { matchId: m.id, userId: players[24]! } })).toBe(1);

    const notes = await testDb().notification.findMany({ where: { type: "LOBBY_ASSIGNED" } });
    expect(notes).toHaveLength(50);
    expect(notes.find((n) => n.userId === players[49])!.title).toBe("You're in Lobby 2");

    // Closing again (or the cron after an admin) never splits twice.
    expect(await testDb().auditLog.count({ where: { action: "match.lobbies.split" } })).toBe(1);
  });

  it("moves an entry's payment with it", async () => {
    const m = await createMatch(admin.id, { game: "FREE_FIRE", mode: "SOLO", maxSlots: 2 });
    const ids = await fill(m.id, 3);
    const last = await testDb().registration.findFirstOrThrow({ where: { userId: ids[2]! } });
    await testDb().payment.create({
      data: { userId: ids[2]!, matchId: m.id, registrationId: last.id, orderId: "ord_1", amountPaise: 1000, status: "PAID", expiresAt: new Date() },
    });
    await transitionMatchStatus(admin, { matchId: m.id, to: "REGISTRATION_CLOSED" });
    const moved = await testDb().registration.findUniqueOrThrow({ where: { id: last.id } });
    expect(moved.matchId).not.toBe(m.id);
    expect((await testDb().payment.findUniqueOrThrow({ where: { orderId: "ord_1" } })).matchId).toBe(moved.matchId);
  });

  it("pairs 1v1 players into games; the odd one waits for an admin and is refunded at the start", async () => {
    const m = await createMatch(admin.id, { game: "VALORANT", mode: "ONE_V_ONE", maxSlots: 2 });
    const ids = await fill(m.id, 5, "VALORANT");
    await transitionMatchStatus(admin, { matchId: m.id, to: "REGISTRATION_CLOSED" });
    const lobbies = await lobbiesOf(m.id);
    expect(lobbies.map((l) => l._count.registrations)).toEqual([2, 2]);
    expect(lobbies[1]!.title).toMatch(/— Game 2$/);
    const odd = await testDb().registration.findFirstOrThrow({ where: { userId: ids[4]! } });
    expect(odd).toMatchObject({ matchId: m.id, status: "WAITLISTED" });
    expect(await testDb().notification.count({ where: { type: "LOBBY_UNPLACED", userId: ids[4]! } })).toBe(1);

    await transitionMatchStatus(admin, { matchId: m.id, to: "LIVE" });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: odd.id } })).status).toBe("CANCELLED");
    expect(await testDb().notification.count({ where: { type: "REGISTRATION_REMOVED", userId: ids[4]! } })).toBe(1);
  });
});
