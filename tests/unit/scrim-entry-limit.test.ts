import { describe, expect, it } from "vitest";
import { entryCap } from "@/lib/lobbies";
import { matchFormSchema, type MatchFormInput } from "@/lib/match-schema";
import { cardAction } from "@/lib/registration-rules";

const valid: MatchFormInput = {
  game: "FREE_FIRE",
  kind: "SCRIM",
  mode: "SOLO",
  title: "Solo Rush",
  startsAt: "2026-10-25T21:00",
  closeOffsetMinutes: "30",
  minSlots: "20",
  entryFee: "40",
  prize: "400",
};

describe("optional maximum entries for scrims (DECISIONS M75)", () => {
  it("is optional: empty means no limit", () => {
    expect(matchFormSchema.parse(valid).entryLimit).toBeNull();
    expect(matchFormSchema.parse({ ...valid, entryLimit: "" }).entryLimit).toBeNull();
    expect(matchFormSchema.parse({ ...valid, entryLimit: "60" }).entryLimit).toBe(60);
  });

  it("must be a whole number, at least 2 and at least the minimum", () => {
    for (const bad of ["1", "2.5", "abc"]) {
      expect(matchFormSchema.safeParse({ ...valid, entryLimit: bad }).success).toBe(false);
    }
    const r = matchFormSchema.safeParse({ ...valid, entryLimit: "10" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["entryLimit"]);
  });

  it("is ignored for tournament matches (they keep their fixed capacity)", () => {
    const r = matchFormSchema.safeParse({
      ...valid,
      kind: "TOURNAMENT",
      tournamentId: "t1",
      entryLimit: "60",
    });
    expect(r.success && r.data.entryLimit).toBeNull();
  });

  it("caps an open-entry scrim; then new entries join the waitlist", () => {
    const scrim = {
      isEntryList: false,
      tournamentId: null,
      bracketRound: null,
      parentMatchId: null,
      maxSlots: 48,
    };
    expect(entryCap({ ...scrim, entryLimit: null })).toBeNull();
    expect(entryCap({ ...scrim, entryLimit: 60 })).toBe(60);
    const card = {
      status: "REGISTRATION_OPEN" as const,
      registrationOpensAt: null,
      registrationClosesAt: new Date("2026-10-25T15:00:00Z"),
      entryFeePaise: 0,
      maxSlots: 48,
      openEntry: true,
    };
    const now = new Date("2026-10-25T10:00:00Z");
    expect(cardAction({ ...card, confirmedCount: 500 }, now, true)).toBe("REGISTER");
    expect(cardAction({ ...card, confirmedCount: 59, entryLimit: 60 }, now, true)).toBe("REGISTER");
    expect(cardAction({ ...card, confirmedCount: 60, entryLimit: 60 }, now, true)).toBe("WAITLIST");
  });
});
