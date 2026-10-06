import { describe, expect, it } from "vitest";
import {
  canCancelRegistration,
  canSeeRoomCredentials,
  cardAction,
  maxTeamMembers,
  placementFor,
  registrationBlock,
} from "@/lib/registration-rules";

const now = new Date("2026-10-01T12:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);
const clean = { bannedAt: null, bannedUntil: null, registrationBlockedUntil: null };
const open = { status: "REGISTRATION_OPEN" as const, registrationClosesAt: later(60), entryFeePaise: 0 };

describe("registrationBlock", () => {
  it("allows a clean player into an open free match", () => {
    expect(registrationBlock(clean, open, now, false)).toBeNull();
  });
  it("blocks bans and strike blocks", () => {
    expect(registrationBlock({ ...clean, bannedAt: now }, open, now, false)).toBe("BLOCKED");
    expect(registrationBlock({ ...clean, registrationBlockedUntil: later(10) }, open, now, false)).toBe("BLOCKED");
  });
  it("requires REGISTRATION_OPEN and before the close time", () => {
    expect(registrationBlock(clean, { ...open, status: "UPCOMING" }, now, false)).toBe("NOT_OPEN");
    expect(registrationBlock(clean, { ...open, registrationClosesAt: now }, now, false)).toBe("CLOSED");
  });
  it("blocks paid matches until payments are enabled", () => {
    expect(registrationBlock(clean, { ...open, entryFeePaise: 1000 }, now, false)).toBe("PAYMENTS_DISABLED");
    expect(registrationBlock(clean, { ...open, entryFeePaise: 1000 }, now, true)).toBeNull();
  });
});

describe("slots and cancellation", () => {
  it("confirms while slots remain, then waitlists", () => {
    expect(placementFor(0, 2)).toBe("CONFIRMED");
    expect(placementFor(1, 2)).toBe("CONFIRMED");
    expect(placementFor(2, 2)).toBe("WAITLISTED");
  });
  it("allows cancelling only before registration closes", () => {
    expect(canCancelRegistration(open, now)).toBe(true);
    // Paid entries are final (DECISIONS M50); an unpaid attempt can still be dropped.
    expect(canCancelRegistration({ ...open, entryFeePaise: 7000 }, now)).toBe(false);
    expect(canCancelRegistration({ ...open, entryFeePaise: 7000 }, now, false)).toBe(true);
    expect(canCancelRegistration({ ...open, registrationClosesAt: now }, now)).toBe(false);
    expect(canCancelRegistration({ ...open, status: "LIVE" }, now)).toBe(false);
  });
  it("caps team members at squad size + 3", () => {
    expect(maxTeamMembers(4)).toBe(7);
  });
});

describe("room credentials (DECISIONS M20)", () => {
  it("are for confirmed players only, as soon as they are shared, until the match is over", () => {
    for (const status of ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] as const) {
      expect(canSeeRoomCredentials({ status }, true)).toBe(true);
      expect(canSeeRoomCredentials({ status }, false)).toBe(false);
    }
    for (const status of ["RESULTS_PENDING", "COMPLETED", "CANCELLED"] as const) {
      expect(canSeeRoomCredentials({ status }, true)).toBe(false);
    }
  });
});

describe("card button", () => {
  const card = { ...open, confirmedCount: 0, maxSlots: 2 };
  it("shows the right action", () => {
    expect(cardAction(card, now, false)).toBe("REGISTER");
    expect(cardAction({ ...card, confirmedCount: 2 }, now, false)).toBe("WAITLIST");
    expect(cardAction({ ...card, status: "UPCOMING" }, now, false)).toBe("SOON");
    expect(cardAction({ ...card, status: "LIVE" }, now, false)).toBe("CLOSED");
    expect(cardAction({ ...card, registrationClosesAt: now }, now, false)).toBe("CLOSED");
    expect(cardAction({ ...card, entryFeePaise: 100 }, now, false)).toBe("PAID_SOON");
  });
});
