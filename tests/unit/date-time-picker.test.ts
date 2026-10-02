import { describe, expect, it } from "vitest";
import { joinValue, label12h, nextDays, splitValue, summary, timeOf, to24h } from "@/lib/date-time-picker";

describe("date-time picker helpers", () => {
  it("splits and rebuilds datetime-local values in 12-hour parts", () => {
    expect(splitValue("2026-10-02T20:30")).toEqual({ date: "2026-10-02", hour12: 8, minute: 30, pm: true });
    expect(splitValue("2026-10-02T00:05")).toEqual({ date: "2026-10-02", hour12: 12, minute: 5, pm: false });
    expect(splitValue("2026-10-02T12:00")).toMatchObject({ hour12: 12, pm: true });
    expect(splitValue("")).toMatchObject({ date: "", hour12: null });
    expect(to24h(12, 0, false)).toBe("00:00");
    expect(to24h(12, 0, true)).toBe("12:00");
    expect(to24h(8, 45, true)).toBe("20:45");
    expect(joinValue("2026-10-02", "20:45")).toBe("2026-10-02T20:45");
    expect(joinValue("", "20:45")).toBe("");
    expect(timeOf("2026-10-02T09:15")).toBe("09:15");
  });

  it("labels days and times for people", () => {
    expect(label12h("20:00")).toBe("8 PM");
    expect(label12h("09:30")).toBe("9:30 AM");
    expect(summary("2026-10-02T20:00")).toBe("Fri, 2 Oct · 8 PM IST");
    expect(summary("")).toBeNull();
  });

  it("lists the next IST days from today", () => {
    // 20:00 UTC on 30 Sep is already 1 Oct in IST.
    const days = nextDays(new Date("2026-09-30T20:00:00Z"), 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days.map((d) => d.top)).toEqual(["Today", "Tomorrow", "Sat"]);
    expect(days[0]!.bottom).toBe("1 Oct");
  });
});
