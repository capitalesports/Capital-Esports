import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(path.resolve(import.meta.dirname, "../../prisma/schema.prisma"), "utf8");
function model(name: string): string {
  const m = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!m) throw new Error(`model ${name} not found`);
  return m[1]!;
}

describe("database constraints (Phase 8 checklist)", () => {
  // Optional since Google sign-up (DECISIONS M31), still unique.
  it("phone is unique", () => expect(model("User")).toMatch(/phone\s+String\?\s+@unique/));
  it("a Google account links to one user", () => expect(model("User")).toMatch(/googleId\s+String\?\s+@unique/));
  it("game IDs are unique per game and one profile per game per user", () => {
    expect(model("GameProfile")).toContain("@@unique([game, gameId])");
    expect(model("GameProfile")).toContain("@@unique([userId, game])");
  });
  it("one registration per player per match", () => expect(model("Registration")).toContain("@@unique([matchId, userId])"));
  it("has the required indexes", () => {
    expect(model("Match")).toContain("@@index([startsAt, status])");
    expect(model("Registration")).toContain("@@index([matchId, status])");
    expect(model("PointsEntry")).toContain("@@index([seasonId, userId])");
  });
  it("money is stored as integer paise", () => {
    const moneyFields = schema.match(/\w+Paise\s+\w+/g) ?? [];
    expect(moneyFields.length).toBeGreaterThanOrEqual(5);
    for (const f of moneyFields) expect(f, f).toMatch(/Paise\s+Int$/);
  });
  it("payment, refund and transfer references are unique (idempotency)", () => {
    expect(model("Payment")).toMatch(/orderId\s+String\s+@unique/);
    expect(model("Payment")).toMatch(/refundId\s+String\?\s+@unique/);
    expect(model("Payout")).toMatch(/transferId\s+String\?\s+@unique/);
    expect(model("WebhookEvent")).toMatch(/eventKey\s+String\s+@unique/);
  });
});
