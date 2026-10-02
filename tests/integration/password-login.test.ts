import { beforeEach, describe, expect, it } from "vitest";
import { loginWithPassword, PASSWORD_RATE_LIMITS } from "@/server/services/password-login";
import { hashPassword } from "@/lib/password-hash";
import { createUser, resetDb, testDb } from "../helpers/db";

const PASSWORD = "Staff%Pass123";

async function staff(role: "ADMIN" | "MODERATOR" | "PLAYER", email: string) {
  const u = await createUser({ role, email });
  await testDb().user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return u;
}

beforeEach(async () => {
  await resetDb();
});

describe("staff email + password login", () => {
  it("logs in an admin or moderator with the right password (email in any case)", async () => {
    const admin = await staff("ADMIN", "boss@example.com");
    expect(await loginWithPassword({ email: " Boss@Example.com ", password: PASSWORD }, "1.1.1.1")).toMatchObject({
      id: admin.id,
    });
    const mod = await staff("MODERATOR", "mod@example.com");
    expect((await loginWithPassword({ email: "mod@example.com", password: PASSWORD }, "1.1.1.1")).id).toBe(mod.id);
  });

  it("gives the same answer for a wrong password, an unknown email and a player", async () => {
    await staff("ADMIN", "boss@example.com");
    await staff("PLAYER", "player@example.com");
    for (const input of [
      { email: "boss@example.com", password: "wrong-password" },
      { email: "nobody@example.com", password: PASSWORD },
      { email: "player@example.com", password: PASSWORD },
    ]) {
      await expect(loginWithPassword(input, "2.2.2.2")).rejects.toMatchObject({
        code: "VALIDATION",
        message: "Wrong email or password.",
      });
    }
  });

  it("validates input and refuses banned or deleted accounts", async () => {
    await expect(loginWithPassword({ email: "a@b.co" }, "3.3.3.3")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(loginWithPassword(null, "3.3.3.3")).rejects.toMatchObject({ code: "VALIDATION" });
    const admin = await staff("ADMIN", "gone@example.com");
    await testDb().user.update({ where: { id: admin.id }, data: { deletedAt: new Date() } });
    await expect(loginWithPassword({ email: "gone@example.com", password: PASSWORD }, "3.3.3.3")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("limits attempts per email", async () => {
    await staff("ADMIN", "boss@example.com");
    for (let i = 0; i < PASSWORD_RATE_LIMITS.perEmail.limit; i++) {
      await expect(loginWithPassword({ email: "boss@example.com", password: "nope" }, `4.4.4.${i}`)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await expect(loginWithPassword({ email: "boss@example.com", password: PASSWORD }, "4.4.4.99")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
