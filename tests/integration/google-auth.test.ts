import { beforeEach, describe, expect, it } from "vitest";
import type { GoogleProfile } from "@/server/auth/google-verifier";
import { loginWithVerifiedPhone } from "@/server/services/auth";
import { banUser } from "@/server/services/admin-users";
import { attachGoogleProfile, loginWithGoogle, nameFromGoogle } from "@/server/services/google-auth";
import { approvePayout, revealPayoutUpi, savePayoutMethod } from "@/server/services/payouts";
import { registerForMatch } from "@/server/services/registration";
import { createMatch, createUser, resetDb, testDb } from "../helpers/db";

const google = (over: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: "g-123",
  email: "new.player@gmail.com",
  name: "Satyam Kumar",
  picture: "https://lh3.googleusercontent.com/a/photo",
  ...over,
});

beforeEach(async () => {
  await resetDb();
});

describe("Continue with Google (DECISIONS M29, M31)", () => {
  it("creates the account straight away, without a phone, filled from Google", async () => {
    const out = await loginWithGoogle(google());
    expect(out).toMatchObject({ isNew: true, profileComplete: false }); // date of birth still missing
    const u = await testDb().user.findUniqueOrThrow({ where: { id: out.id } });
    expect(u).toMatchObject({
      phone: null,
      googleId: "g-123",
      email: "new.player@gmail.com",
      displayName: "Satyam Kumar",
      avatarUrl: "https://lh3.googleusercontent.com/a/photo",
    });
    expect(u.emailVerifiedAt).not.toBeNull();
    // Next time: the same account.
    expect(await loginWithGoogle(google())).toMatchObject({ id: out.id, isNew: false });
  });

  it("logs in an existing account whose verified email is the Google email, and links it", async () => {
    const existing = await createUser({ email: "old.player@gmail.com", displayName: "Old Name" });
    const out = await loginWithGoogle(google({ sub: "g-777", email: "old.player@gmail.com" }));
    expect(out).toMatchObject({ id: existing.id, isNew: false });
    const u = await testDb().user.findUniqueOrThrow({ where: { id: existing.id } });
    // Linked, but what the player set is kept.
    expect(u).toMatchObject({ googleId: "g-777", displayName: "Old Name" });
  });

  it("a phone account can link Google later without taking another account's email", async () => {
    await createUser({ email: "taken@gmail.com" });
    const { id } = await loginWithVerifiedPhone("+919812300002");
    await attachGoogleProfile(id, google({ sub: "g-9", email: "taken@gmail.com" }));
    expect(await testDb().user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      googleId: "g-9",
      email: null,
    });
  });

  it("a banned Google account can't sign in, nor sign up again after its account is gone", async () => {
    const out = await loginWithGoogle(google({ sub: "g-b", email: "banned@gmail.com" }));
    const admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" as const };
    await banUser(admin, { userId: out.id, reason: "Cheating in lobby" });
    await expect(loginWithGoogle(google({ sub: "g-b", email: "banned@gmail.com" }))).rejects.toMatchObject({
      code: "BANNED",
    });
    // Even with a fresh Google id (account deleted/merged), the banned email is refused.
    await testDb().user.update({ where: { id: out.id }, data: { googleId: null, email: null } });
    await expect(loginWithGoogle(google({ sub: "g-new", email: "banned@gmail.com" }))).rejects.toMatchObject({
      code: "BANNED",
    });
  });

  it("saves a UPI ID without a phone for prizes paid by hand; Cashfree approval asks for one (DECISIONS M33)", async () => {
    const out = await loginWithGoogle(google({ sub: "g-pay", email: "pay@gmail.com" }));
    await testDb().user.update({
      where: { id: out.id },
      data: { dateOfBirth: new Date("1999-01-01T00:00:00Z") },
    });
    await savePayoutMethod(
      { id: out.id, role: "PLAYER" },
      { kind: "UPI", accountHolderName: "Pay Er", vpa: "payer@okaxis" },
    );
    const method = await testDb().payoutMethod.findUniqueOrThrow({ where: { userId: out.id } });
    expect(method).toMatchObject({ vpa: "payer@okaxis" });
    expect(method.beneficiaryId.startsWith("unregistered_")).toBe(true);

    const adminId = (await createUser({ role: "ADMIN" })).id;
    const payout = await testDb().payout.create({ data: { userId: out.id, place: 1, amountPaise: 10_000 } });
    await expect(approvePayout({ id: adminId, role: "ADMIN" }, { payoutId: payout.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("isn't registered with Cashfree"),
    });
    // Paying by hand still works.
    expect(await revealPayoutUpi({ id: adminId, role: "ADMIN" }, { payoutId: payout.id })).toMatchObject({
      vpa: "payer@okaxis",
    });
  });

  it("asks for a mobile number before paid entry, not before free matches", async () => {
    const out = await loginWithGoogle(google({ sub: "g-reg", email: "reg@gmail.com" }));
    await testDb().user.update({
      where: { id: out.id },
      data: { dateOfBirth: new Date("2000-01-01T00:00:00Z") },
    });
    await testDb().gameProfile.create({
      data: { userId: out.id, game: "BGMI", gameId: "5123400001", ign: "Googler" },
    });
    const admin = (await createUser({ role: "ADMIN" })).id;
    const me = { id: out.id, role: "PLAYER" as const };
    const free = await createMatch(admin, { game: "BGMI" });
    expect((await registerForMatch(me, { matchId: free.id })).status).toBe("CONFIRMED");
    const paid = await createMatch(admin, { game: "BGMI", entryFeePaise: 5000 });
    await expect(registerForMatch(me, { matchId: paid.id })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      fieldErrors: { missing: ["mobile number"] },
    });
  });

  it("uses the Google name only when it is a valid display name", () => {
    expect(nameFromGoogle("Satyam Kumar")).toBe("Satyam Kumar");
    expect(nameFromGoogle("Ritesh 🔥 Pro")).toBe("Ritesh");
    expect(nameFromGoogle("🔥")).toBeNull();
    expect(nameFromGoogle(null)).toBeNull();
  });
});
