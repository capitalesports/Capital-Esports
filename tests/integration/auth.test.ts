import { beforeEach, describe, expect, it } from "vitest";
import { POST as sessionPOST } from "@/app/api/auth/session/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { getOtpVerifier } from "@/server/auth/otp-verifier";
import { loginWithVerifiedPhone, SESSION_RATE_LIMITS } from "@/server/services/auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";
import { createUser, resetDb, testDb } from "../helpers/db";

function sessionRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3100/api/auth/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3100",
      origin: "http://localhost:3100",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("OTP verifier selection", () => {
  it("uses the stub only when explicitly allowed", async () => {
    expect(getOtpVerifier().kind).toBe("stub");
    await expect(getOtpVerifier().verify("stub:9876543210")).resolves.toEqual({ phone: "+919876543210" });
    await expect(getOtpVerifier().verify("forged-token")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    process.env.AUTH_OTP_STUB = "false";
    try {
      expect(() => getOtpVerifier()).toThrowError(/not configured/);
    } finally {
      process.env.AUTH_OTP_STUB = "true";
    }
  });

  it("never allows the stub on the production deployment", () => {
    process.env.VERCEL_ENV = "production";
    try {
      expect(() => getOtpVerifier()).toThrowError(/not configured/);
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe("loginWithVerifiedPhone", () => {
  it("creates a user on first login and reuses it after", async () => {
    const first = await loginWithVerifiedPhone("+919876500001");
    expect(first).toMatchObject({ isNew: true, profileComplete: false });
    const again = await loginWithVerifiedPhone("+919876500001");
    expect(again).toMatchObject({ id: first.id, isNew: false });
    expect(await testDb().user.count()).toBe(1);
  });

  it("reports profile completeness for returning users", async () => {
    await createUser({ phone: "+919876500002", games: [{ game: "BGMI", gameId: "5550001", ign: "x" }] });
    await expect(loginWithVerifiedPhone("+919876500002")).resolves.toMatchObject({ profileComplete: true });
  });

  it("rejects a banned account with the reason", async () => {
    await createUser({ phone: "+919876500003" });
    await testDb().user.update({
      where: { phone: "+919876500003" },
      data: { bannedAt: new Date(), banReason: "Hacking" },
    });
    await expect(loginWithVerifiedPhone("+919876500003")).rejects.toMatchObject({
      code: "BANNED",
      message: expect.stringContaining("Hacking"),
    });
  });

  it("allows login again after a timed ban expires", async () => {
    await createUser({ phone: "+919876500004" });
    await testDb().user.update({
      where: { phone: "+919876500004" },
      data: { bannedAt: new Date(Date.now() - 86400_000), bannedUntil: new Date(Date.now() - 1000) },
    });
    await expect(loginWithVerifiedPhone("+919876500004")).resolves.toMatchObject({ isNew: false });
  });

  it("rejects a banned phone even with no account (cannot re-register)", async () => {
    await testDb().ban.create({ data: { phone: "+919876500005", reason: "Multi-accounting" } });
    await expect(loginWithVerifiedPhone("+919876500005")).rejects.toMatchObject({ code: "BANNED" });
    expect(await testDb().user.count()).toBe(0);
  });

  it("rejects a merged (soft-deleted) account", async () => {
    await createUser({ phone: "+919876500006" });
    await testDb().user.update({ where: { phone: "+919876500006" }, data: { deletedAt: new Date() } });
    await expect(loginWithVerifiedPhone("+919876500006")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rate-limits session creation per phone", async () => {
    const phone = "+919876500007";
    for (let i = 0; i < SESSION_RATE_LIMITS.perPhone.limit; i++) await loginWithVerifiedPhone(phone);
    await expect(loginWithVerifiedPhone(phone)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("POST /api/auth/session", () => {
  it("issues an httpOnly session cookie for a verified phone", async () => {
    const res = await sessionPOST(sessionRequest({ idToken: "stub:+919876500010" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, isNew: true, needsProfile: true });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const claims = await verifySession(token, process.env.SESSION_SECRET!);
    const user = await testDb().user.findUniqueOrThrow({ where: { phone: "+919876500010" } });
    expect(claims?.userId).toBe(user.id);
  });

  it("rejects cross-site requests (CSRF)", async () => {
    const res = await sessionPOST(sessionRequest({ idToken: "stub:+919876500011" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await testDb().user.count()).toBe(0);
  });

  it("validates the body", async () => {
    const res = await sessionPOST(sessionRequest({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("returns a generic error for a bad token", async () => {
    const res = await sessionPOST(sessionRequest({ idToken: "stub:not-a-phone" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid or has expired/);
  });

  it("returns 403 with a clear message for banned users", async () => {
    await createUser({ phone: "+919876500012" });
    await testDb().user.update({
      where: { phone: "+919876500012" },
      data: { bannedAt: new Date(), banReason: "Abuse" },
    });
    const res = await sessionPOST(sessionRequest({ idToken: "stub:+919876500012" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("banned");
  });

  it("rate-limits per IP with 429", async () => {
    const ip = "10.9.9.9";
    let last: Response | null = null;
    for (let i = 0; i <= SESSION_RATE_LIMITS.perIp.limit; i++) {
      last = await sessionPOST(sessionRequest({ idToken: `stub:+9198765${String(20000 + i)}` }, { "x-forwarded-for": ip }));
    }
    expect(last!.status).toBe(429);
  });

  it("logout clears the cookie", async () => {
    const res = await logoutPOST(
      new Request("http://localhost:3100/api/auth/logout", {
        method: "POST",
        headers: { host: "localhost:3100", origin: "http://localhost:3100" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });
});
