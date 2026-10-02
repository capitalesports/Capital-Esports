import { describe, expect, it } from "vitest";
import { banMessage, isAccountBanned, isBanRecordActive, isRegistrationBlocked } from "@/lib/bans";
import { checkImage, detectImageMime } from "@/lib/image";
import { isHiddenAdminPath, isProtectedPath } from "@/lib/protected-paths";
import { formatIST, istDayKey, istInputToUtc, startOfIstDay, utcToIstInput } from "@/lib/time";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe("image magic bytes", () => {
  it("detects supported formats", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(JPG)).toBe("image/jpeg");
    expect(detectImageMime(WEBP)).toBe("image/webp");
    expect(detectImageMime(GIF)).toBe("image/gif");
  });

  it("rejects non-images even with an image name", () => {
    expect(detectImageMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(checkImage(new TextEncoder().encode("%PDF-1.7"), 1000)).toMatchObject({ ok: false });
  });

  it("enforces size and emptiness", () => {
    expect(checkImage(new Uint8Array(), 1000)).toMatchObject({ ok: false });
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(PNG);
    expect(checkImage(big, 2 * 1024 * 1024)).toMatchObject({
      ok: false,
      error: expect.stringContaining("2 MB"),
    });
    expect(checkImage(PNG, 1000)).toEqual({ ok: true, mime: "image/png" });
  });
});

describe("bans", () => {
  const now = new Date("2026-09-27T00:00:00Z");

  it("treats bannedAt without end as permanent", () => {
    expect(isAccountBanned({ bannedAt: now, bannedUntil: null }, now)).toBe(true);
  });

  it("expires timed bans", () => {
    const past = new Date("2026-09-26T00:00:00Z");
    const future = new Date("2026-09-28T00:00:00Z");
    expect(isAccountBanned({ bannedAt: now, bannedUntil: past }, now)).toBe(false);
    expect(isAccountBanned({ bannedAt: now, bannedUntil: future }, now)).toBe(true);
    expect(isAccountBanned({ bannedAt: null, bannedUntil: null }, now)).toBe(false);
  });

  it("blocks registration during a strike block but allows login", () => {
    const u = {
      bannedAt: null,
      bannedUntil: null,
      registrationBlockedUntil: new Date("2026-10-01T00:00:00Z"),
    };
    expect(isAccountBanned(u, now)).toBe(false);
    expect(isRegistrationBlocked(u, now)).toBe(true);
    const expired = { ...u, registrationBlockedUntil: new Date("2026-09-01T00:00:00Z") };
    expect(isRegistrationBlocked(expired, now)).toBe(false);
  });

  it("evaluates ban records", () => {
    expect(isBanRecordActive({ expiresAt: null, liftedAt: null }, now)).toBe(true);
    expect(isBanRecordActive({ expiresAt: null, liftedAt: now }, now)).toBe(false);
    expect(isBanRecordActive({ expiresAt: new Date("2026-09-01T00:00:00Z"), liftedAt: null }, now)).toBe(
      false,
    );
  });

  it("explains bans", () => {
    expect(banMessage({ bannedAt: now, bannedUntil: null, banReason: "Cheating" })).toContain("Cheating");
  });
});

describe("IST time helpers", () => {
  it("converts IST form input to UTC and back", () => {
    const utc = istInputToUtc("2026-09-27T21:00")!;
    expect(utc.toISOString()).toBe("2026-09-27T15:30:00.000Z");
    expect(utcToIstInput(utc)).toBe("2026-09-27T21:00");
    expect(istInputToUtc("27/09/2026 9pm")).toBeNull();
  });

  it("computes IST day boundaries", () => {
    // 20:00 UTC on the 27th is 01:30 IST on the 28th.
    const late = new Date("2026-09-27T20:00:00Z");
    expect(istDayKey(late)).toBe("2026-09-28");
    expect(startOfIstDay(late).toISOString()).toBe("2026-09-27T18:30:00.000Z");
    expect(startOfIstDay(late, 1).toISOString()).toBe("2026-09-28T18:30:00.000Z");
  });

  it("formats in IST", () => {
    expect(formatIST(new Date("2026-09-27T15:30:00Z"))).toMatch(/9:00\s?pm IST$/i);
  });
});

describe("hidden admin paths (DECISIONS M40)", () => {
  it("covers /admin and everything under it, nothing else", () => {
    for (const p of ["/admin", "/admin/", "/admin/users", "/admin/deletion-requests"]) {
      expect(isHiddenAdminPath(p)).toBe(true);
    }
    for (const p of ["/administrator", "/login", "/dashboard", "/api/admin"]) {
      expect(isHiddenAdminPath(p)).toBe(false);
    }
  });
});

describe("protected paths", () => {
  it("protects dashboard, profile, teams and admin", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/admin/users")).toBe(true);
    expect(isProtectedPath("/teams")).toBe(true);
    expect(isProtectedPath("/teams/abc123")).toBe(false);
    expect(isProtectedPath("/profile")).toBe(true);
    expect(isProtectedPath("/scrims")).toBe(false);
    expect(isProtectedPath("/administrator")).toBe(false);
  });
});
