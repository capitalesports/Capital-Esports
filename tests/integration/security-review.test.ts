import { beforeEach, describe, expect, it } from "vitest";
import { stubOutbox } from "@/server/providers/email";
import {
  confirmEmailVerification,
  loginWithEmailCode,
  requestEmailLogin,
  requestEmailVerification,
} from "@/server/services/email";
import { cancelMatch } from "@/server/services/matches";
import { leaveRoster, registerForMatch } from "@/server/services/registration";
import { submitResult } from "@/server/services/results";
import { createTournament } from "@/server/services/tournaments";
import { listMyNotifications } from "@/server/services/inbox";
import { searchSite, normaliseQuery } from "@/server/queries/search";
import { parseInput } from "@/server/validation";
import { z } from "zod";
import type { Actor } from "@/lib/roles";
import { addDays, utcToIstInput } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

/** Fixes from the pre-launch security review (2026-10-10, DECISIONS M53). */

const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let admin: Actor;
let mod: Actor;

beforeEach(async () => {
  await resetDb();
  stubOutbox.length = 0;
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

function lastCode(to: string): string {
  const mail = [...stubOutbox].reverse().find((m) => m.to === to);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code emailed to ${to}`);
  return code;
}

describe("rosters: a captain can't trap another player", () => {
  it("a player put on a roster by game ID can leave it and then register", async () => {
    const m = await createMatch(admin.id, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const victim = await createPlayer("BGMI");
    const victimId = (await testDb().gameProfile.findFirstOrThrow({ where: { userId: victim.id } }))
      .gameId;
    await registerForMatch(actor(cap), {
      matchId: m.id,
      teamName: "Grief Squad",
      players: [
        { gameId: victimId, ign: "Exact Ign" },
        { gameId: "71000002", ign: "Two" },
        { gameId: "71000003", ign: "Three" },
      ],
    });
    // The victim is on the roster and can't register...
    await expect(
      registerForMatch(actor(victim), {
        matchId: m.id,
        teamName: "Real Team",
        players: [
          { gameId: "72000001", ign: "A" },
          { gameId: "72000002", ign: "B" },
          { gameId: "72000003", ign: "C" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // ...until they leave it.
    await expect(leaveRoster(actor(cap), { matchId: m.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await leaveRoster(actor(victim), { matchId: m.id });
    const r = await registerForMatch(actor(victim), {
      matchId: m.id,
      teamName: "Real Team",
      players: [
        { gameId: "72000001", ign: "A" },
        { gameId: "72000002", ign: "B" },
        { gameId: "72000003", ign: "C" },
      ],
    });
    expect(r.status).toBe("CONFIRMED");
    expect(await testDb().auditLog.count({ where: { action: "registration.leaveRoster" } })).toBe(
      1,
    );
  });
});

describe("moderators run scrims, admins run tournaments", () => {
  it("a moderator can't cancel a tournament sign-up list, an admin can; scrims stay open to moderators", async () => {
    const day = utcToIstInput(addDays(new Date(), 2)).slice(0, 10);
    const t = await createTournament(admin, {
      game: "BGMI",
      mode: "SQUAD",
      title: "Sec Cup",
      startsAt: `${day}T20:00`,
      prizePool: "0",
    });
    await expect(
      cancelMatch(mod, { matchId: t.entryMatchId!, reason: "Not allowed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelMatch(admin, { matchId: t.entryMatchId!, reason: "Admin may" });
    const scrim = await createMatch(admin.id, {});
    await expect(
      cancelMatch(mod, { matchId: scrim.id, reason: "Server down" }),
    ).resolves.toBeTruthy();
  });
});

describe("players can't submit results while staff enter them", () => {
  it("submitResult is refused by default", async () => {
    const p = await createPlayer();
    await expect(
      submitResult(actor(p), { matchId: "x", placement: 1, kills: 9 }, null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("email codes", () => {
  async function verifiedPlayer(email: string) {
    const u = await createUser();
    await requestEmailVerification(actor(u), { email });
    await confirmEmailVerification(actor(u), { code: lastCode(email) });
    return u;
  }

  it("wrong codes are counted across new codes: after 10 the email is locked for the day", async () => {
    await verifiedPlayer("lock@example.in");
    const wrong = async () => {
      const real = lastCode("lock@example.in");
      const bad = real === "000000" ? "111111" : "000000";
      await expect(
        loginWithEmailCode({ email: "lock@example.in", code: bad }),
      ).rejects.toBeTruthy();
    };
    for (let round = 0; round < 2; round++) {
      await requestEmailLogin({ email: "lock@example.in" }, `10.1.0.${round}`);
      for (let i = 0; i < 5; i++) await wrong();
    }
    await requestEmailLogin({ email: "lock@example.in" }, "10.1.0.9");
    await expect(
      loginWithEmailCode({ email: "lock@example.in", code: lastCode("lock@example.in") }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("at most 3 login codes per email per day", async () => {
    await verifiedPlayer("daily@example.in");
    for (let i = 0; i < 3; i++)
      await requestEmailLogin({ email: "daily@example.in" }, `10.3.0.${i}`);
    await expect(
      requestEmailLogin({ email: "daily@example.in" }, "10.3.0.9"),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringContaining("3 login codes a day"),
    });
  });

  it("staff accounts never get an email login code", async () => {
    const staff = await createUser({ role: "ADMIN", email: "boss@example.in" });
    await testDb().user.update({ where: { id: staff.id }, data: { emailVerifiedAt: new Date() } });
    await requestEmailLogin({ email: "boss@example.in" }, "10.2.0.1");
    expect(stubOutbox.filter((m) => m.to === "boss@example.in")).toHaveLength(0);
  });
});

describe("URL and input tampering (security review 2)", () => {
  it("a game ID claimed by someone else isn't linked to a roster unless the in-game name matches too", async () => {
    const m = await createMatch(admin.id, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const squatter = await createPlayer("BGMI");
    const uid = (await testDb().gameProfile.findFirstOrThrow({ where: { userId: squatter.id } }))
      .gameId;
    await registerForMatch(actor(cap), {
      matchId: m.id,
      teamName: "Real Squad",
      players: [
        { gameId: uid, ign: "RealOwnerName" },
        { gameId: "73000002", ign: "Two" },
        { gameId: "73000003", ign: "Three" },
      ],
    });
    const row = await testDb().registrationMember.findFirstOrThrow({
      where: { matchId: m.id, gameId: uid },
    });
    expect(row.userId).toBeNull();
  });

  it("odd page numbers and control characters don't crash anything", async () => {
    const p = await createPlayer();
    await expect(listMyNotifications(actor(p), 1.01)).resolves.toBeTruthy();
    await expect(listMyNotifications(actor(p), Number.POSITIVE_INFINITY)).resolves.toBeTruthy();
    const q = normaliseQuery("\u0000'\"<script>");
    expect(q).not.toContain("\u0000");
    await expect(searchSite(q!)).resolves.toBeTruthy();
    expect(parseInput(z.object({ a: z.string() }), { a: "x\u0000y" })).toEqual({ a: "xy" });
  });
});
