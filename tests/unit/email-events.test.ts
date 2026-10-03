import { describe, expect, it } from "vitest";
import { EMAIL_EVENTS, NOTIFICATION_TYPES } from "@/lib/notifications";

describe("which notifications are emailed (DECISIONS M47)", () => {
  it("only slot confirmed, the 30-minute reminder and match cancelled", () => {
    expect([...EMAIL_EVENTS].sort()).toEqual(
      [
        "MATCH_CANCELLED",
        "MATCH_STARTING_SOON",
        "REGISTRATION_CONFIRMED",
        "WAITLIST_PROMOTED",
      ].sort(),
    );
    // Every emailed event is a real notification type; prizes, rooms and results are bell-only.
    for (const t of EMAIL_EVENTS) expect(NOTIFICATION_TYPES).toContain(t);
    for (const t of [
      "PRIZE_WON",
      "ROOM_CREDENTIALS_AVAILABLE",
      "RESULTS_APPROVED",
      "ANNOUNCEMENT",
    ] as const) {
      expect(EMAIL_EVENTS.has(t), t).toBe(false);
    }
  });
});
