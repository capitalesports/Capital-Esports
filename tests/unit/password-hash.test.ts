import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password-hash";

describe("staff password hashing", () => {
  it("verifies the right password only, with a fresh salt each time", async () => {
    const a = await hashPassword("Correct%Horse9");
    const b = await hashPassword("Correct%Horse9");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("Correct");
    expect(await verifyPassword("Correct%Horse9", a)).toBe(true);
    expect(await verifyPassword("correct%horse9", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });

  it("rejects malformed stored values", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
  });
});
