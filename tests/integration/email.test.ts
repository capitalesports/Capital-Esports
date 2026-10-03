import { beforeEach, describe, expect, it } from "vitest";
import { stubOutbox } from "@/server/providers/email";
import {
  confirmEmailVerification,
  EMAIL_CODE,
  loginWithEmailCode,
  removeEmail,
  requestEmailLogin,
  requestEmailVerification,
  setEmailOptIn,
} from "@/server/services/email";
import { notify } from "@/server/services/notify";
import type { Actor } from "@/lib/roles";
import { createMatch, createUser, resetDb, testDb } from "../helpers/db";

const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

/** The 6-digit code in the latest email to `to`. */
function lastCode(to: string): string {
  const mail = [...stubOutbox].reverse().find((m) => m.to === to);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code emailed to ${to}`);
  return code;
}

async function verifiedUser(email: string) {
  const u = await createUser();
  await requestEmailVerification(actor(u), { email });
  await confirmEmailVerification(actor(u), { code: lastCode(email) });
  return u;
}

let ip = 0;
const nextIp = () => `10.0.0.${++ip}`;

beforeEach(async () => {
  await resetDb();
  stubOutbox.length = 0;
});

describe("email verification on the profile", () => {
  it("needs login and a valid email / code", async () => {
    await expect(requestEmailVerification(null, { email: "a@b.in" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(confirmEmailVerification(null, { code: "123456" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(removeEmail(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(setEmailOptIn(null, { optIn: false })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const u = await createUser();
    await expect(
      requestEmailVerification(actor(u), { email: "not-an-email" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(confirmEmailVerification(actor(u), { code: "12ab" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(setEmailOptIn(actor(u), { optIn: "yes" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("verifies with the emailed code (lower-cased), which works only once", async () => {
    const u = await createUser();
    await requestEmailVerification(actor(u), { email: "  Player@Example.IN " });
    const code = lastCode("player@example.in");
    await expect(
      confirmEmailVerification(actor(u), { code: code === "000000" ? "111111" : "000000" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await confirmEmailVerification(actor(u), { code });
    const saved = await testDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(saved.email).toBe("player@example.in");
    expect(saved.emailVerifiedAt).not.toBeNull();
    await expect(confirmEmailVerification(actor(u), { code })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(
      await testDb().auditLog.count({ where: { entityId: u.id, action: "user.email.verify" } }),
    ).toBe(1);
  });

  it("refuses an email another account uses, and locks a code after too many wrong tries", async () => {
    await verifiedUser("taken@example.in");
    const other = await createUser();
    await expect(
      requestEmailVerification(actor(other), { email: "taken@example.in" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await requestEmailVerification(actor(other), { email: "mine@example.in" });
    const code = lastCode("mine@example.in");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < EMAIL_CODE.maxAttempts; i++) {
      await expect(confirmEmailVerification(actor(other), { code: wrong })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await expect(confirmEmailVerification(actor(other), { code })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("removes the email", async () => {
    const u = await verifiedUser("gone@example.in");
    await removeEmail(actor(u));
    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).email).toBeNull();
  });
});

describe("logging in by email", () => {
  it("sends a code only to a verified email, and answers the same either way", async () => {
    await expect(requestEmailLogin({ email: "x" }, nextIp())).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await requestEmailLogin({ email: "nobody@example.in" }, nextIp())).toEqual({
      email: "nobody@example.in",
    });
    expect(stubOutbox.filter((m) => m.to === "nobody@example.in")).toHaveLength(0);

    const u = await verifiedUser("login@example.in");
    await requestEmailLogin({ email: "Login@Example.in" }, nextIp());
    const code = lastCode("login@example.in");
    await expect(
      loginWithEmailCode({
        email: "login@example.in",
        code: code === "000000" ? "111111" : "000000",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const session = await loginWithEmailCode({ email: "login@example.in", code });
    expect(session.id).toBe(u.id);
    await expect(loginWithEmailCode({ email: "login@example.in", code })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("applies the same bans as phone login", async () => {
    const u = await verifiedUser("banned@example.in");
    await testDb().user.update({
      where: { id: u.id },
      data: { bannedAt: new Date(), banReason: "Cheating" },
    });
    await requestEmailLogin({ email: "banned@example.in" }, nextIp());
    await expect(
      loginWithEmailCode({ email: "banned@example.in", code: lastCode("banned@example.in") }),
    ).rejects.toMatchObject({ code: "BANNED" });
  });

  it("rate-limits code requests per email", async () => {
    await verifiedUser("spam@example.in");
    for (let i = 0; i < 3; i++) await requestEmailLogin({ email: "spam@example.in" }, nextIp());
    await expect(requestEmailLogin({ email: "spam@example.in" }, nextIp())).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("email notifications", () => {
  it("emails verified, opted-in players only", async () => {
    const on = await verifiedUser("on@example.in");
    const off = await verifiedUser("off@example.in");
    await setEmailOptIn(actor(off), { optIn: false });
    const none = await createUser({ email: null });
    const admin = await createUser({ role: "ADMIN" });
    const m = await createMatch(admin.id, {});
    stubOutbox.length = 0;
    await notify({
      type: "MATCH_CANCELLED",
      userIds: [on.id, off.id, none.id],
      matchId: m.id,
      reason: "Server outage",
    });
    expect(stubOutbox.map((x) => x.to)).toEqual(["on@example.in"]);
    expect(stubOutbox[0]!.text).toContain(`/scrims/${m.id}`);
  });

  it("sends no email for bell-only events such as announcements and prizes (DECISIONS M47)", async () => {
    const on = await verifiedUser("on@example.in");
    stubOutbox.length = 0;
    await notify({
      type: "ANNOUNCEMENT",
      userIds: [on.id],
      title: "Cup tonight",
      body: "Sign up now",
      url: "/tournament",
    });
    await notify({
      type: "PRIZE_WON",
      userIds: [on.id],
      amountPaise: 10000,
      place: 1,
      eventTitle: "Solo Rush",
    });
    expect(stubOutbox).toHaveLength(0);
    // The bell still has both.
    expect(await testDb().notification.count({ where: { userId: on.id } })).toBe(2);
  });
});
