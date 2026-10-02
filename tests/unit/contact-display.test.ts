import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  dobYears,
  formatPhone,
  joinDob,
  maskEmail,
  maskPhone,
  splitDob,
} from "@/lib/contact-display";

describe("contact display", () => {
  it("masks and formats phone numbers", () => {
    expect(maskPhone("+918742968987")).toBe("+91 ••••••8987");
    expect(formatPhone("+918742968987")).toBe("+91 87429 68987");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
  });

  it("masks emails but keeps the domain", () => {
    expect(maskEmail("player@gmail.com")).toBe("p•••••@gmail.com");
    expect(maskEmail("ab@x.in")).toBe("a•••@x.in");
  });
});

describe("date of birth parts", () => {
  it("splits and joins, clamping the day to the month", () => {
    expect(splitDob("2006-02-14")).toEqual({ year: 2006, month: 2, day: 14 });
    expect(splitDob("")).toEqual({ year: null, month: null, day: null });
    expect(joinDob({ year: 2006, month: 2, day: 14 })).toBe("2006-02-14");
    expect(joinDob({ year: 2006, month: 2, day: 31 })).toBe("2006-02-28");
    expect(joinDob({ year: 2004, month: 2, day: 31 })).toBe("2004-02-29");
    expect(joinDob({ year: null, month: 2, day: 3 })).toBe("");
  });

  it("knows month lengths and the allowed birth years", () => {
    expect(daysInMonth(4, 2020)).toBe(30);
    expect(daysInMonth(null, null)).toBe(31);
    const years = dobYears(new Date("2026-09-30T00:00:00Z"), 10, 100);
    expect(years[0]).toBe(2016);
    expect(years.at(-1)).toBe(1926);
  });
});
