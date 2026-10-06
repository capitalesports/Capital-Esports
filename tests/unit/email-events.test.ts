import { describe, expect, it } from "vitest";
import { EMAIL_EVENTS, NOTIFICATION_TYPES } from "@/lib/notifications";

describe("which notifications are emailed (DECISIONS M51)", () => {
  it("only the slot confirmation", () => {
    expect([...EMAIL_EVENTS].sort()).toEqual(["REGISTRATION_CONFIRMED", "WAITLIST_PROMOTED"]);
    // Every emailed event is a real notification type; prizes, rooms and results are bell-only.
    for (const t of EMAIL_EVENTS) expect(NOTIFICATION_TYPES).toContain(t);
    for (const t of [
      "PRIZE_WON",
      "ROOM_CREDENTIALS_AVAILABLE",
      "RESULTS_APPROVED",
      "ANNOUNCEMENT",
      "MATCH_STARTING_SOON",
      "MATCH_CANCELLED",
    ] as const) {
      expect(EMAIL_EVENTS.has(t), t).toBe(false);
    }
  });
});
