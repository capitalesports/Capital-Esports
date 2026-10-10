import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { normalisePath } from "@/server/services/analytics";
import { messageFor, NOTIFICATION_TYPES, PUSH_EVENTS, REMINDER_EVENTS, type NotificationEvent } from "@/lib/notifications";

const SAMPLE: Record<NotificationEvent["type"], NotificationEvent> = {
  REGISTRATION_CONFIRMED: { type: "REGISTRATION_CONFIRMED", userIds: ["u"], matchId: "m1" },
  WAITLIST_PROMOTED: { type: "WAITLIST_PROMOTED", userIds: ["u"], matchId: "m1" },
  ROSTER_INVITE: { type: "ROSTER_INVITE", userIds: ["u"], matchId: "m1" },
  TEAM_INVITE: { type: "TEAM_INVITE", userIds: ["u"], teamId: "t1" },
  ROOM_CREDENTIALS_AVAILABLE: { type: "ROOM_CREDENTIALS_AVAILABLE", userIds: ["u"], matchId: "m1" },
  MATCH_STARTING_SOON: { type: "MATCH_STARTING_SOON", userIds: ["u"], matchId: "m1" },
  RESULTS_APPROVED: { type: "RESULTS_APPROVED", userIds: ["u"], matchId: "m1" },
  DISPUTE_OPENED: { type: "DISPUTE_OPENED", userIds: ["u"], matchId: "m1" },
  DISPUTE_RESOLVED: { type: "DISPUTE_RESOLVED", userIds: ["u"], matchId: "m1", outcome: "RESOLVED" },
  PAYOUT_STATUS: { type: "PAYOUT_STATUS", userIds: ["u"], payoutId: "p1", status: "SUCCESS" },
  MATCH_CANCELLED: { type: "MATCH_CANCELLED", userIds: ["u"], matchId: "m1", reason: "Not enough players" },
  RESULTS_OPEN: { type: "RESULTS_OPEN", userIds: ["u"], matchId: "m1" },
  REGISTRATION_REMOVED: { type: "REGISTRATION_REMOVED", userIds: ["u"], matchId: "m1", reason: "Wrong game ID" },
  ANNOUNCEMENT: { type: "ANNOUNCEMENT", userIds: ["u"], title: "Diwali cup", body: "Registrations open Friday.", url: "/tournaments" },
  LOBBY_ASSIGNED: { type: "LOBBY_ASSIGNED", userIds: ["u"], matchId: "m2", lobby: "Lobby 2" },
  LOBBY_UNPLACED: { type: "LOBBY_UNPLACED", userIds: ["u"], matchId: "m1" },
  TOURNAMENT_LOBBY: { type: "TOURNAMENT_LOBBY", userIds: ["u"], matchId: "m2", lobby: 2 },
  TOURNAMENT_UNPLACED: { type: "TOURNAMENT_UNPLACED", userIds: ["u"], matchId: "m1" },
  BRACKET_READY: { type: "BRACKET_READY", userIds: ["u"], matchId: "m3" },
  PAYMENT_REJECTED: {
    type: "PAYMENT_REJECTED",
    userIds: ["u"],
    matchId: "m1",
    reason: "Amount not received",
    released: false,
  },
  PRIZE_WON: { type: "PRIZE_WON", userIds: ["u"], amountPaise: 45_400, place: 1, eventTitle: "Solo Rush" },
};

describe("notification event mapping", () => {
  it.each(NOTIFICATION_TYPES)("%s has a title, body and an in-app link", (type) => {
    const m = messageFor(SAMPLE[type], { matchTitle: "Night Scrim", teamName: "Wolves", amount: "₹500" });
    expect(m.type).toBe(type);
    expect(m.title.length).toBeGreaterThan(3);
    expect(m.body.length).toBeGreaterThan(10);
    expect(m.url.startsWith("/")).toBe(true);
    expect(m.body).not.toMatch(/undefined|null/);
  });

  it("names the match and links to it", () => {
    const m = messageFor(SAMPLE.MATCH_STARTING_SOON, { matchTitle: "BGMI Night Scrim" });
    expect(m).toMatchObject({ title: "Starting in 30 minutes", url: "/scrims/m1" });
    expect(m.body).toContain("BGMI Night Scrim");
  });

  it("never puts room credentials in the message", () => {
    const m = messageFor(SAMPLE.ROOM_CREDENTIALS_AVAILABLE, { matchTitle: "X" });
    expect(m.body).toMatch(/dashboard/);
    expect(m.body).not.toMatch(/password\s*[:=]/i);
  });

  it("tells a winner the prize, the place and the 2-working-day payout promise (DECISIONS M28)", () => {
    const m = messageFor(SAMPLE.PRIZE_WON);
    expect(m.title).toContain("won");
    expect(m.body).toContain("1st in Solo Rush");
    expect(m.body).toContain("₹454");
    expect(m.body).toContain("within 2 working days");
    expect(m.url).toBe("/profile");
  });

  it("describes payouts and disputes", () => {
    expect(messageFor(SAMPLE.PAYOUT_STATUS, { amount: "₹500" }).body).toBe("Your prize of ₹500 has been paid.");
    expect(messageFor({ ...SAMPLE.PAYOUT_STATUS, status: "FAILED" } as NotificationEvent).title).toBe("Prize payout update");
    expect(messageFor({ type: "DISPUTE_RESOLVED", userIds: [], matchId: "m", outcome: "DISMISSED" }, { matchTitle: "M" }).body).toContain("dismissed");
    expect(messageFor(SAMPLE.DISPUTE_OPENED).url).toBe("/admin/reports");
    expect(messageFor(SAMPLE.TEAM_INVITE, { teamName: "Wolves" }).body).toContain("Wolves");
  });

  it("pushes important events and sends out-of-app reminders only for match starts", () => {
    expect(PUSH_EVENTS.has("MATCH_STARTING_SOON")).toBe(true);
    expect(PUSH_EVENTS.has("DISPUTE_OPENED")).toBe(false);
    expect([...REMINDER_EVENTS]).toEqual(["MATCH_STARTING_SOON"]);
  });
});

// ---------------------------------------------------------------------------
// Service worker: load the real public/sw.js in a sandbox.
// ---------------------------------------------------------------------------

function loadServiceWorker() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const cachePut = vi.fn();
  const sandbox: Record<string, unknown> = {
    URL,
    self: {
      location: { origin: "https://arenax.example" },
      addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: async () => ({ put: cachePut, add: async () => {} }),
      match: async () => undefined,
      keys: async () => [],
      delete: async () => true,
    },
    fetch: vi.fn(async () => ({ ok: true, type: "basic", clone: () => ({}) })),
  };
  const src = readFileSync(path.resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
  vm.runInNewContext(`${src}\nthis.shouldCache = shouldCache;`, sandbox);
  return { shouldCache: sandbox.shouldCache as (url: string, method: string) => boolean, listeners, cachePut };
}

describe("service worker cache policy", () => {
  const { shouldCache, listeners, cachePut } = loadServiceWorker();
  const o = "https://arenax.example";

  it.each([
    "/",
    "/dashboard",
    "/profile",
    "/notifications",
    "/scrims/abc123",
    "/admin/matches",
    "/api/matches/abc/room",
    "/api/payments/ord_1",
    "/api/auth/session",
    "/api/files/results/x.png",
    "/payments/return?order_id=1",
  ])("never caches %s", (p) => {
    expect(shouldCache(`${o}${p}`, "GET")).toBe(false);
  });

  it("caches only static build assets, icons and the offline page", () => {
    expect(shouldCache(`${o}/_next/static/chunks/app.js`, "GET")).toBe(true);
    expect(shouldCache(`${o}/icons/192`, "GET")).toBe(true);
    expect(shouldCache(`${o}/offline.html`, "GET")).toBe(true);
    expect(shouldCache(`${o}/art/empty-offline.png`, "GET")).toBe(true);
    expect(shouldCache(`${o}/_next/static/chunks/app.js`, "POST")).toBe(false);
    expect(shouldCache(`https://evil.example/_next/static/x.js`, "GET")).toBe(false);
    expect(shouldCache(`${o}/_next/static/x.js?token=1`, "GET")).toBe(false);
  });

  it("does not intercept API calls such as room credentials", () => {
    const respondWith = vi.fn();
    listeners.fetch!({ request: { url: `${o}/api/matches/m1/room`, method: "GET", mode: "cors" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("serves navigations from the network and never stores pages", async () => {
    let pending: Promise<unknown> | undefined;
    listeners.fetch!({ request: { url: `${o}/dashboard`, method: "GET", mode: "navigate" }, respondWith: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(cachePut).not.toHaveBeenCalled();
  });
});

describe("analytics path rules", () => {
  it("keeps paths only, drops queries, admin, api and junk", () => {
    expect(normalisePath("/scrims?game=bgmi")).toBe("/scrims");
    expect(normalisePath("/admin/users")).toBeNull();
    expect(normalisePath("/api/x")).toBeNull();
    expect(normalisePath("https://evil.example/")).toBeNull();
    expect(normalisePath("//evil.example")).toBeNull();
    expect(normalisePath(42)).toBeNull();
  });
});
