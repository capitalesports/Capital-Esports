import { describe, expect, it } from "vitest";
import {
  normalizeReferralCode,
  periodStart,
  referralCodeFor,
  referralPeriodFrom,
  referralRewards,
  summarizeReferrals,
} from "@/lib/referral";

describe("referral codes (DECISIONS M52)", () => {
  it("normalizes typed codes and rejects anything else", () => {
    expect(normalizeReferralCode(" khushi7xk ")).toBe("KHUSHI7XK");
    expect(normalizeReferralCode("AB1")).toBeNull();
    expect(normalizeReferralCode("ABCDEFGHIJKLM")).toBeNull();
    expect(normalizeReferralCode("KH-USHI")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it("builds a code from the name plus 3 unambiguous characters", () => {
    const zero = () => 0;
    expect(referralCodeFor("Khushi Sharma", zero)).toBe("KHUSHIAAA");
    expect(referralCodeFor("꧁ʀᴏʜᴀɴ꧂", zero)).toBe("PLAYERAAA");
    expect(referralCodeFor(null, () => 0.999)).toBe("PLAYER999");
    expect(normalizeReferralCode(referralCodeFor("Om"))).not.toBeNull();
    expect(referralCodeFor("x", Math.random)).not.toMatch(/[01OI]{1}$/);
  });

  it("reads the admin period from the URL", () => {
    expect(referralPeriodFrom("7d")).toBe("7d");
    expect(referralPeriodFrom("junk")).toBe("all");
    const now = new Date("2026-10-08T00:00:00Z");
    expect(periodStart("all", now)).toBeNull();
    expect(periodStart("7d", now)).toEqual(new Date("2026-10-01T00:00:00Z"));
  });
});

describe("referral summary", () => {
  it("adds up each referrer's players, slots and paid entries", () => {
    const d = (day: number) => new Date(Date.UTC(2026, 9, day));
    const rows = summarizeReferrals([
      { userId: "a", referrerId: "K", slots: 3, paidSlots: 2, paidPaise: 14000, lastPaidAt: d(5) },
      { userId: "b", referrerId: "K", slots: 1, paidSlots: 0, paidPaise: 0, lastPaidAt: null },
      { userId: "c", referrerId: "K", slots: 0, paidSlots: 0, paidPaise: 0, lastPaidAt: null },
      { userId: "d", referrerId: "R", slots: 4, paidSlots: 4, paidPaise: 28000, lastPaidAt: d(7) },
    ]);
    expect(rows).toEqual([
      {
        referrerId: "R",
        joined: 1,
        booked: 1,
        paidPlayers: 1,
        slots: 4,
        paidSlots: 4,
        paidPaise: 28000,
        lastPaidAt: d(7),
      },
      {
        referrerId: "K",
        joined: 3,
        booked: 2,
        paidPlayers: 1,
        slots: 4,
        paidSlots: 2,
        paidPaise: 14000,
        lastPaidAt: d(5),
      },
    ]);
  });
});

describe("referral rewards", () => {
  it("earns 1 free slot per 5 paid referred players", () => {
    expect(referralRewards(4, 0)).toEqual({ earned: 0, used: 0, available: 0, towardNext: 4 });
    expect(referralRewards(5, 0)).toEqual({ earned: 1, used: 0, available: 1, towardNext: 0 });
    expect(referralRewards(12, 1)).toEqual({ earned: 2, used: 1, available: 1, towardNext: 2 });
    expect(referralRewards(3, 2).available).toBe(0);
  });
});
