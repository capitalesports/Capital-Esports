import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getEmailSender } from "@/server/providers/email";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { hashPassword, PASSWORD_RULES, verifyPassword } from "@/lib/password-hash";
import { isProfileComplete } from "@/lib/profile";
import { dateOfBirthSchema, displayNameSchema } from "@/lib/validators";
import { assertAccountCanLogIn, assertPhoneNotBanned } from "./auth";
import { codeField, consumeCode, EMAIL_RATE_LIMITS, emailField, sendCode } from "./email";

/**
 * Sign up with username, email, date of birth and password (DECISIONS M38). The account exists
 * from the first step but can't log in until the 6-digit code sent to the email is entered: an
 * email nobody has proven can be taken over by whoever does prove it.
 */

const startSchema = z.object({
  displayName: displayNameSchema,
  email: emailField,
  dateOfBirth: dateOfBirthSchema,
  password: z
    .string()
    .min(PASSWORD_RULES.min, `Use at least ${PASSWORD_RULES.min} characters`)
    .max(PASSWORD_RULES.max, `Use at most ${PASSWORD_RULES.max} characters`),
});

const TAKEN = () =>
  new AppError("CONFLICT", "An account with this email already exists. Log in instead.", {
    email: ["Already registered: log in instead"],
  });

/** Step 1: create (or refresh) the unproven account and email it a code. */
export async function startPasswordSignup(input: unknown, ip: string): Promise<{ email: string }> {
  const { displayName, email, dateOfBirth, password } = parseInput(startSchema, input);
  try {
    getEmailSender(); // throws on the live site until an email provider is connected
  } catch {
    throw new AppError(
      "UNAVAILABLE",
      "Sign-up with email isn't available yet. Please use “Continue with Google”.",
    );
  }
  const rate = "Too many sign-up attempts. Please wait 15 minutes and try again.";
  await enforceRateLimit(
    `signup:ip:${ip}`,
    EMAIL_RATE_LIMITS.perIp.limit,
    EMAIL_RATE_LIMITS.perIp.windowSeconds,
    rate,
  );
  await enforceRateLimit(
    `signup:${email}`,
    EMAIL_RATE_LIMITS.perEmail.limit,
    EMAIL_RATE_LIMITS.perEmail.windowSeconds,
    rate,
  );
  await assertPhoneNotBanned(null, email);

  const existing = await db.user.findUnique({ where: { email } });
  if (
    existing &&
    (existing.emailVerifiedAt || existing.googleId || existing.phone || existing.deletedAt)
  ) {
    throw TAKEN();
  }
  const data = { displayName, dateOfBirth, passwordHash: await hashPassword(password) };
  let user: { id: string };
  if (existing) {
    // While a code is still out, only the same person (same password: "Resend code") may continue;
    // someone else can't swap in their own password for a victim's pending sign-up.
    const pending = await db.emailCode.findFirst({
      where: {
        userId: existing.id,
        purpose: "VERIFY",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    const samePerson =
      !!existing.passwordHash && (await verifyPassword(password, existing.passwordHash));
    if (pending && !samePerson) {
      throw new AppError(
        "CONFLICT",
        "A sign-up for this email is waiting for its code. Enter the code from that email, or try again in 10 minutes.",
      );
    }
    // An earlier attempt that never entered its code proved nothing: this attempt replaces it.
    user = samePerson ? existing : await db.user.update({ where: { id: existing.id }, data });
  } else {
    try {
      user = await db.user.create({ data: { ...data, email } });
    } catch {
      throw TAKEN(); // the same email signing up twice at once
    }
  }
  await sendCode(user, email, "VERIFY");
  return { email };
}

/** Step 2: the emailed code proves the email; the account can now log in. */
export async function confirmPasswordSignup(
  input: unknown,
): Promise<{ id: string; profileComplete: boolean }> {
  const { email, code } = parseInput(z.object({ email: emailField, code: codeField }), input);
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || !user.passwordHash) {
    throw new AppError("VALIDATION", "That code is wrong or has expired. Request a new one.", {
      code: ["Wrong or expired code"],
    });
  }
  await consumeCode({ userId: user.id, email, purpose: "VERIFY" }, code);
  await assertPhoneNotBanned(null, email);
  assertAccountCanLogIn(user);
  const verified = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "user.signup.password",
      entityType: "User",
      entityId: user.id,
      after: { email },
    });
    return updated;
  });
  return { id: verified.id, profileComplete: isProfileComplete(verified) };
}
