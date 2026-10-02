import { beforeEach, describe, expect, it } from "vitest";
import { stubOutbox } from "@/server/providers/email";
import { loginWithGoogle } from "@/server/services/google-auth";
import { loginWithPassword } from "@/server/services/password-login";
import { confirmPasswordSignup, startPasswordSignup } from "@/server/services/password-signup";
import { createUser, resetDb, testDb } from "../helpers/db";

const IP = "9.9.9.9";
const form = (over: Record<string, unknown> = {}) => ({
  displayName: "Rohan",
  email: "Rohan@Example.in",
  dateOfBirth: "2004-11-11",
  password: "secret-pass-1",
  ...over,
});

function lastCode(to: string): string {
  const mail = [...stubOutbox].reverse().find((m) => m.to === to);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code emailed to ${to}`);
  return code;
}

beforeEach(async () => {
  await resetDb();
  stubOutbox.length = 0;
});

describe("email + password sign-up", () => {
  it("creates the account, emails a code, and the code finishes sign-up with a complete profile", async () => {
    expect(await startPasswordSignup(form(), IP)).toEqual({ email: "rohan@example.in" });
    const pending = await testDb().user.findUniqueOrThrow({ where: { email: "rohan@example.in" } });
    expect(pending).toMatchObject({ displayName: "Rohan", emailVerifiedAt: null, phone: null });
    expect(pending.passwordHash).toMatch(/^scrypt\$/);

    const out = await confirmPasswordSignup({ email: "rohan@example.in", code: lastCode("rohan@example.in") });
    expect(out).toEqual({ id: pending.id, profileComplete: true });
    const audit = await testDb().auditLog.findFirst({ where: { action: "user.signup.password" } });
    expect(audit?.entityId).toBe(pending.id);
    // The new player can now log in with the password.
    expect((await loginWithPassword({ email: "rohan@example.in", password: "secret-pass-1" }, IP)).id).toBe(pending.id);
  });

  it("can't log in with the password before the email code is entered", async () => {
    await startPasswordSignup(form(), IP);
    await expect(loginWithPassword({ email: "rohan@example.in", password: "secret-pass-1" }, IP)).rejects.toMatchObject({
      message: "Wrong email or password.",
    });
  });

  it("validates every field", async () => {
    await expect(startPasswordSignup(null, IP)).rejects.toMatchObject({ code: "VALIDATION" });
    for (const bad of [
      { displayName: "R" },
      { email: "not-an-email" },
      { dateOfBirth: "2030-01-01" },
      { dateOfBirth: "11/11/2004" },
      { password: "short" },
    ]) {
      await expect(startPasswordSignup(form(bad), IP)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(confirmPasswordSignup({ email: "rohan@example.in", code: "12" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses an email that already belongs to a real account", async () => {
    await createUser({ email: "taken@example.in" });
    await expect(startPasswordSignup(form({ email: "taken@example.in" }), IP)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("lets a second attempt replace an unfinished one, and only the latest code works", async () => {
    await startPasswordSignup(form(), IP);
    const first = lastCode("rohan@example.in");
    await startPasswordSignup(form({ displayName: "Rohan K", password: "another-pass-2" }), "9.9.9.8");
    const second = lastCode("rohan@example.in");
    expect(await testDb().user.count({ where: { email: "rohan@example.in" } })).toBe(1);
    if (first !== second) {
      await expect(confirmPasswordSignup({ email: "rohan@example.in", code: first })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await confirmPasswordSignup({ email: "rohan@example.in", code: second });
    const user = await testDb().user.findUniqueOrThrow({ where: { email: "rohan@example.in" } });
    expect(user.displayName).toBe("Rohan K");
    expect((await loginWithPassword({ email: "rohan@example.in", password: "another-pass-2" }, IP)).id).toBe(user.id);
  });

  it("rejects a wrong code and a finished sign-up's email", async () => {
    await startPasswordSignup(form(), IP);
    const code = lastCode("rohan@example.in");
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(confirmPasswordSignup({ email: "rohan@example.in", code: wrong })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await confirmPasswordSignup({ email: "rohan@example.in", code });
    await expect(confirmPasswordSignup({ email: "rohan@example.in", code })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses a banned email", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await testDb().ban.create({
      data: { email: "rohan@example.in", reason: "cheating", createdById: admin.id },
    });
    await expect(startPasswordSignup(form(), IP)).rejects.toMatchObject({ code: "BANNED" });
  });

  it("an unproven sign-up can't keep the email from its Google owner", async () => {
    await startPasswordSignup(form(), IP);
    const squatter = await testDb().user.findUniqueOrThrow({ where: { email: "rohan@example.in" } });
    const out = await loginWithGoogle({
      sub: "google-rohan",
      email: "rohan@example.in",
      name: "Rohan Real",
      picture: null,
    });
    expect(out.id).not.toBe(squatter.id);
    const owner = await testDb().user.findUniqueOrThrow({ where: { id: out.id } });
    expect(owner.email).toBe("rohan@example.in");
    expect(owner.emailVerifiedAt).not.toBeNull();
    expect((await testDb().user.findUniqueOrThrow({ where: { id: squatter.id } })).email).toBeNull();
  });
});
