import { describe, expect, it } from "vitest";
import {
  carouselItemSchema,
  contentLink,
  contentSchema,
  socialLinksSchema,
  sponsorSchema,
} from "@/lib/content";
import {
  capacityText,
  isHeadToHead,
  isTeamMode,
  matchFormSchema,
  maxSlotsFor,
  MODES_FOR_GAME,
  playersPerSlot,
  type MatchFormInput,
} from "@/lib/match-schema";
import { formatEntryFee, formatINR, paiseToRupeesInput, rupeesToPaise } from "@/lib/money";

const valid: MatchFormInput = {
  game: "BGMI",
  kind: "SCRIM",
  mode: "SQUAD",
  title: "BGMI Night Scrim",
  startsAt: "2026-10-01T21:00",
  closeOffsetMinutes: "30",
  entryFee: "0",
  prize: "500",
};

function errorsOf(input: MatchFormInput) {
  const r = matchFormSchema.safeParse(input);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("matchFormSchema", () => {
  it("converts IST times to UTC and rupees to paise", () => {
    const m = matchFormSchema.parse({
      ...valid,
      entryFee: "49.50",
      registrationOpensAt: "2026-10-01T12:00",
    });
    expect(m.startsAt.toISOString()).toBe("2026-10-01T15:30:00.000Z");
    expect(m.registrationClosesAt.toISOString()).toBe("2026-10-01T15:00:00.000Z");
    expect(m.registrationOpensAt?.toISOString()).toBe("2026-10-01T06:30:00.000Z");
    expect(m.entryFeePaise).toBe(4950);
    expect(m.prizePaise).toBe(50000);
    expect(m.streamUrl).toBeNull();
  });

  it("defaults the close offset to 30 minutes", () => {
    const m = matchFormSchema.parse({ ...valid, closeOffsetMinutes: undefined });
    expect(m.startsAt.getTime() - m.registrationClosesAt.getTime()).toBe(30 * 60_000);
  });

  it("validates minimum slots (default 2, 0..a full lobby)", () => {
    expect(matchFormSchema.parse(valid).minSlots).toBe(2);
    expect(matchFormSchema.parse({ ...valid, minSlots: "0" }).minSlots).toBe(0);
    expect(matchFormSchema.parse({ ...valid, minSlots: "25" }).minSlots).toBe(25);
    expect(errorsOf({ ...valid, minSlots: "26" })).toHaveProperty("minSlots");
    expect(errorsOf({ ...valid, game: "VALORANT", mode: "ONE_V_ONE", minSlots: "3" })).toHaveProperty("minSlots");
    expect(errorsOf({ ...valid, minSlots: "-1" })).toHaveProperty("minSlots");
    expect(errorsOf({ ...valid, minSlots: "1.5" })).toHaveProperty("minSlots");
  });

  it("rejects modes that do not exist for a game", () => {
    expect(errorsOf({ ...valid, game: "VALORANT", mode: "SQUAD" })).toHaveProperty(
      "mode",
    );
    expect(errorsOf({ ...valid, mode: "FIVE_V_FIVE" })).toHaveProperty("mode");
  });

  it("sets the capacity from the mode: 2 sides head-to-head, a full lobby otherwise", () => {
    expect(matchFormSchema.parse({ ...valid, game: "VALORANT", mode: "FIVE_V_FIVE" }).maxSlots).toBe(2);
    expect(matchFormSchema.parse({ ...valid, game: "FREE_FIRE", mode: "FOUR_V_FOUR" }).maxSlots).toBe(2);
    expect(matchFormSchema.parse({ ...valid, game: "BGMI", mode: "TWO_V_TWO" }).maxSlots).toBe(2);
    expect(matchFormSchema.parse(valid).maxSlots).toBe(25);
    expect(matchFormSchema.parse({ ...valid, game: "FREE_FIRE", mode: "SOLO" }).maxSlots).toBe(48);
  });

  it("offers 1v1/2v2 everywhere, 4v4 only in battle royales and 5v5 only in Valorant", () => {
    expect(MODES_FOR_GAME.FREE_FIRE).toEqual([
      "SOLO",
      "DUO",
      "SQUAD",
      "ONE_V_ONE",
      "TWO_V_TWO",
      "FOUR_V_FOUR",
    ]);
    expect(MODES_FOR_GAME.BGMI).toEqual(MODES_FOR_GAME.FREE_FIRE);
    expect(MODES_FOR_GAME.VALORANT).toEqual(["ONE_V_ONE", "TWO_V_TWO", "FIVE_V_FIVE", "SOLO"]);
    expect(
      errorsOf({ ...valid, game: "VALORANT", mode: "FOUR_V_FOUR" }),
    ).toHaveProperty("mode");
    expect(
      errorsOf({ ...valid, game: "FREE_FIRE", mode: "FIVE_V_FIVE" }),
    ).toHaveProperty("mode");
  });

  it("caps slots by lobby capacity", () => {
    expect(maxSlotsFor("BGMI", "SQUAD")).toBe(25);
    expect(maxSlotsFor("FREE_FIRE", "SQUAD")).toBe(12);
    expect(maxSlotsFor("FREE_FIRE", "SOLO")).toBe(48);
    expect(capacityText("FREE_FIRE", "SQUAD")).toBe("Full lobby: up to 12 squads (48 players)");
    expect(capacityText("BGMI", "SOLO")).toBe("Full lobby: up to 100 players");
    expect(capacityText("VALORANT", "ONE_V_ONE")).toBe("2 sides: one 1v1 game");
  });

  it("validates times, money and links", () => {
    expect(errorsOf({ ...valid, startsAt: "" })).toHaveProperty("startsAt");
    expect(errorsOf({ ...valid, entryFee: "-5" })).toHaveProperty("entryFee");
    expect(errorsOf({ ...valid, entryFee: "10.555" })).toHaveProperty("entryFee");
    expect(errorsOf({ ...valid, streamUrl: "javascript:alert(1)" })).toHaveProperty("streamUrl");
    expect(errorsOf({ ...valid, streamUrl: "http://youtube.com/x" })).toHaveProperty("streamUrl");
    expect(errorsOf({ ...valid, title: "ab" })).toHaveProperty("title");
  });

  it("requires registration to open before it closes", () => {
    expect(errorsOf({ ...valid, registrationOpensAt: "2026-10-01T20:45" })).toHaveProperty(
      "registrationOpensAt",
    );
  });

  it("requires a tournament link for tournament matches", () => {
    expect(errorsOf({ ...valid, kind: "TOURNAMENT" })).toHaveProperty("tournamentId");
    expect(errorsOf({ ...valid, kind: "TOURNAMENT", tournamentId: "t1" })).toEqual({});
  });

  it("knows slot sizes", () => {
    expect(playersPerSlot("BGMI", "DUO")).toBe(1);
    expect(playersPerSlot("VALORANT", "FIVE_V_FIVE")).toBe(5);
    expect(isTeamMode("SQUAD")).toBe(true);
    expect(isTeamMode("DUO")).toBe(false);
    expect(playersPerSlot("FREE_FIRE", "ONE_V_ONE")).toBe(1);
    expect(playersPerSlot("BGMI", "TWO_V_TWO")).toBe(2);
    expect(playersPerSlot("FREE_FIRE", "FOUR_V_FOUR")).toBe(4);
    expect(isTeamMode("ONE_V_ONE")).toBe(false);
    expect(isTeamMode("TWO_V_TWO")).toBe(true);
    expect(isHeadToHead("FOUR_V_FOUR")).toBe(true);
    expect(isHeadToHead("SQUAD")).toBe(false);
    expect(maxSlotsFor("BGMI", "ONE_V_ONE")).toBe(2);
  });
});

describe("money helpers", () => {
  it("parses rupees to integer paise", () => {
    expect(rupeesToPaise("49")).toBe(4900);
    expect(rupeesToPaise("49.5")).toBe(4950);
    expect(rupeesToPaise("0.01")).toBe(1);
    expect(rupeesToPaise(20)).toBe(2000);
    expect(rupeesToPaise("1e3")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("-1")).toBeNull();
  });

  it("formats INR", () => {
    expect(formatINR(50000)).toBe("₹500");
    expect(formatINR(4950)).toBe("₹49.50");
    expect(formatINR(10000000)).toBe("₹1,00,000");
    expect(formatEntryFee(0)).toBe("Free");
    expect(paiseToRupeesInput(4950)).toBe("49.50");
    expect(paiseToRupeesInput(5000)).toBe("50");
  });
});

describe("content schemas", () => {
  it("accepts https or uploaded-file logos only", () => {
    expect(sponsorSchema.safeParse({ name: "Acme", logoUrl: "https://x.com/a.png" }).success).toBe(
      true,
    );
    expect(sponsorSchema.safeParse({ name: "Acme", logoUrl: "/api/files/a.png" }).success).toBe(
      true,
    );
    expect(sponsorSchema.safeParse({ name: "Acme", logoUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
  });

  it("treats empty social links as removed", () => {
    const r = socialLinksSchema.parse({ DISCORD: "https://discord.gg/x", WHATSAPP: "" });
    expect(r.DISCORD).toBe("https://discord.gg/x");
    expect(r.WHATSAPP).toBeNull();
    expect(socialLinksSchema.safeParse({ YOUTUBE: "ftp://x" }).success).toBe(false);
  });

  it("validates carousel links", () => {
    expect(
      carouselItemSchema.safeParse({ title: "Winners", linkUrl: "/tournament/bgmi" }).success,
    ).toBe(true);
    expect(
      carouselItemSchema.safeParse({ title: "Winners", linkUrl: "javascript:x" }).success,
    ).toBe(false);
    expect(carouselItemSchema.parse({ title: "Winners", game: "" }).game).toBeNull();
  });
});

describe("scrims video link content", () => {
  it("is validated as a link, while markdown keys stay free text", () => {
    expect(contentSchema.safeParse({ key: "scrims.video", body: "" }).success).toBe(true);
    expect(
      contentSchema.safeParse({ key: "scrims.video", body: "https://youtu.be/abc" }).success,
    ).toBe(true);
    expect(contentSchema.safeParse({ key: "scrims.video", body: "watch this" }).success).toBe(
      false,
    );
    expect(contentSchema.safeParse({ key: "faq", body: "watch this" }).success).toBe(true);
  });
  it("only ever renders an https link", () => {
    expect(contentLink(" https://youtu.be/abc ")).toBe("https://youtu.be/abc");
    expect(contentLink("")).toBeNull();
    expect(contentLink("/api/files/x.mp4")).toBeNull();
    expect(contentLink("javascript:alert(1)")).toBeNull();
  });
});
