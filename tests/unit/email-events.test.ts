import { describe, expect, it } from "vitest";
import { EMAIL_EVENTS } from "@/lib/notifications";

describe("which notifications are emailed (DECISIONS M46)", () => {
  it("room-ready and results notices are in-app only; the 30-minute reminder is emailed", () => {
    expect(EMAIL_EVENTS.has("ROOM_CREDENTIALS_AVAILABLE")).toBe(false);
    expect(EMAIL_EVENTS.has("RESULTS_APPROVED")).toBe(false);
    for (const t of [
      "REGISTRATION_CONFIRMED",
      "MATCH_STARTING_SOON",
      "MATCH_CANCELLED",
      "PRIZE_WON",
    ] as const) {
      expect(EMAIL_EVENTS.has(t), t).toBe(true);
    }
  });
});
