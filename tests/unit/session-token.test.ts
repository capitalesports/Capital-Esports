import { describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
  shouldRollSession,
  signSession,
  verifySession,
} from "@/lib/session-token";

const SECRET = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("session token", () => {
  it("round-trips the user id", async () => {
    const token = await signSession("user_1", SECRET);
    const claims = await verifySession(token, SECRET);
    expect(claims?.userId).toBe("user_1");
    expect(claims!.exp - claims!.iat).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession("user_1", OTHER);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession("user_1", SECRET);
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.sub = "admin";
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const token = await signSession("user_1", SECRET, issued);
    const later = new Date(issued.getTime() + (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    expect(await verifySession(token, SECRET, later)).toBeNull();
  });

  it("rejects missing and garbage tokens", async () => {
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession("not.a.jwt", SECRET)).toBeNull();
  });

  it("refuses short secrets", async () => {
    await expect(signSession("u", "short")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("rolls after a day", async () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const claims = (await verifySession(await signSession("u", SECRET, issued), SECRET, issued))!;
    expect(shouldRollSession(claims, new Date(issued.getTime() + 3600_000))).toBe(false);
    expect(shouldRollSession(claims, new Date(issued.getTime() + 25 * 3600_000))).toBe(true);
  });

  it("uses httpOnly, lax cookies", () => {
    expect(sessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
