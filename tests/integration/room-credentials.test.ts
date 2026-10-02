import { beforeEach, describe, expect, it, vi } from "vitest";
import { signSession, SESSION_COOKIE } from "@/lib/session-token";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T>(fn: T) => fn }));

const { getRoomCredentials } = await import("@/server/services/room");
const { setRoomCredentials } = await import("@/server/services/matches");
const { GET: roomGET } = await import("@/app/api/matches/[id]/room/route");
const { getPublicMatch, listUpcomingScrims, getMyMatches } = await import("@/server/queries/matches");

const ROOM_ID = "ROOM-778899";
const ROOM_PASS = "pw-SECRET-4411";
let adminId: string;

async function setup(status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "LIVE" | "COMPLETED", startsInMin: number) {
  const m = await createMatch(adminId, { startsAt: addMinutes(new Date(), startsInMin), status });
  await testDb().match.update({ where: { id: m.id }, data: { roomId: ROOM_ID, roomPassword: ROOM_PASS } });
  const confirmed = await createPlayer();
  const waitlisted = await createPlayer();
  const outsider = await createPlayer();
  await testDb().registration.createMany({
    data: [
      { matchId: m.id, userId: confirmed.id, status: "CONFIRMED", position: 1 },
      { matchId: m.id, userId: waitlisted.id, status: "WAITLISTED", position: 2 },
    ],
  });
  return { m, confirmed, waitlisted, outsider };
}

async function asUser(id: string | null) {
  jar.clear();
  if (id) jar.set(SESSION_COOKIE, await signSession(id, process.env.SESSION_SECRET!));
}

async function fetchRoom(matchId: string) {
  const res = await roomGET(new Request(`http://localhost/api/matches/${matchId}/room`), { params: Promise.resolve({ id: matchId }) });
  return { status: res.status, text: await res.text(), cache: res.headers.get("cache-control") };
}

beforeEach(async () => {
  await resetDb();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

describe("room credential reveal rules (DECISIONS M20)", () => {
  it("is shown to confirmed players as soon as it is set, days before the start too", async () => {
    for (const status of ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] as const) {
      const { m, confirmed } = await setup(status, 60 * 48);
      expect(await getRoomCredentials({ id: confirmed.id, role: "PLAYER" }, m.id)).toEqual({
        visible: true,
        roomId: ROOM_ID,
        roomPassword: ROOM_PASS,
      });
    }
  });

  it("is never shown to waitlisted players or non-registrants", async () => {
    const { m, waitlisted, outsider } = await setup("LIVE", 5);
    for (const u of [waitlisted, outsider]) {
      expect(await getRoomCredentials({ id: u.id, role: "PLAYER" }, m.id)).toMatchObject({ visible: false, reason: "NOT_CONFIRMED" });
    }
  });

  it("is shown to confirmed squad members on the roster", async () => {
    const m = await createMatch(adminId, { startsAt: addMinutes(new Date(), 5), status: "REGISTRATION_CLOSED", mode: "SQUAD" });
    await testDb().match.update({ where: { id: m.id }, data: { roomId: ROOM_ID, roomPassword: ROOM_PASS } });
    const [captain, mate] = await Promise.all([createPlayer(), createPlayer()]);
    const reg = await testDb().registration.create({ data: { matchId: m.id, userId: captain.id, status: "CONFIRMED", position: 1 } });
    await testDb().registrationMember.create({ data: { registrationId: reg.id, matchId: m.id, userId: mate.id, status: "CONFIRMED" } });
    expect(await getRoomCredentials({ id: mate.id, role: "PLAYER" }, m.id)).toMatchObject({ visible: true });
  });

  it("gives a Valorant player just the room code (no password)", async () => {
    const m = await createMatch(adminId, {
      game: "VALORANT",
      mode: "ONE_V_ONE",
      startsAt: addMinutes(new Date(), 600),
      status: "REGISTRATION_OPEN",
    });
    await testDb().match.update({ where: { id: m.id }, data: { roomId: "PARTY-1234", roomPassword: null } });
    const p = await createPlayer("VALORANT");
    await testDb().registration.create({ data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    expect(await getRoomCredentials({ id: p.id, role: "PLAYER" }, m.id)).toEqual({
      visible: true,
      roomId: "PARTY-1234",
      roomPassword: null,
    });
  });

  it("says NOT_SET to a confirmed player until staff share the room", async () => {
    const m = await createMatch(adminId, { startsAt: addMinutes(new Date(), 600), status: "REGISTRATION_OPEN" });
    const p = await createPlayer();
    await testDb().registration.create({ data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: 1 } });
    expect(await getRoomCredentials({ id: p.id, role: "PLAYER" }, m.id)).toEqual({ visible: false, reason: "NOT_SET" });
  });

  it("notifies confirmed players (not the waitlist) when staff save the room", async () => {
    const { m, confirmed, waitlisted } = await setup("REGISTRATION_OPEN", 600);
    await setRoomCredentials({ id: adminId, role: "ADMIN" }, { matchId: m.id, roomId: "R-1", roomPassword: "P-1" });
    const inbox = await testDb().notification.findMany({ where: { type: "ROOM_CREDENTIALS_AVAILABLE" } });
    expect(inbox.map((n) => n.userId)).toEqual([confirmed.id]);
    expect(inbox.some((n) => n.userId === waitlisted.id)).toBe(false);
    expect((await testDb().match.findUniqueOrThrow({ where: { id: m.id } })).roomNoticeSentAt).not.toBeNull();
  });

  it("stops once the match is over", async () => {
    const { m, confirmed } = await setup("COMPLETED", -60);
    expect(await getRoomCredentials({ id: confirmed.id, role: "PLAYER" }, m.id)).toMatchObject({ visible: false, reason: "ENDED" });
  });
});

describe("credentials never reach anyone but confirmed players", () => {
  it("public queries never select room columns", async () => {
    const { m, confirmed } = await setup("REGISTRATION_CLOSED", 20);
    const payloads = [await getPublicMatch(m.id), await listUpcomingScrims(), await getMyMatches(confirmed.id)];
    for (const p of payloads) {
      const json = JSON.stringify(p);
      expect(json).not.toContain(ROOM_ID);
      expect(json).not.toContain(ROOM_PASS);
      expect(json).not.toContain("roomPassword");
    }
  });

  it("the room endpoint withholds them from everyone else, and is never cached", async () => {
    const { m, waitlisted, outsider } = await setup("REGISTRATION_CLOSED", 20);
    for (const id of [null, waitlisted.id, outsider.id]) {
      await asUser(id);
      const res = await fetchRoom(m.id);
      expect(res.text).not.toContain(ROOM_ID);
      expect(res.text).not.toContain(ROOM_PASS);
      expect(res.cache).toContain("no-store");
    }
    await asUser(null);
    expect((await fetchRoom(m.id)).status).toBe(401);
  });

  it("the room endpoint returns them to a confirmed player", async () => {
    const { m, confirmed, outsider } = await setup("REGISTRATION_CLOSED", 600);
    await asUser(confirmed.id);
    const ok = await fetchRoom(m.id);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain(ROOM_ID);
    expect(ok.text).toContain(ROOM_PASS);
    await asUser(outsider.id);
    expect((await fetchRoom(m.id)).text).not.toContain(ROOM_PASS);
  });
});
