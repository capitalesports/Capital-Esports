import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { normalizeEmail } from "@/lib/input-rules";
import { hashPassword, PASSWORD_RULES, verifyPassword } from "@/lib/password-hash";
import { isProfileComplete } from "@/lib/profile";
import { assertAccountCanLogIn, assertPhoneNotBanned } from "./auth";

export const PASSWORD_RATE_LIMITS = {
  perIp: { limit: 20, windowSeconds: 15 * 60 },
  perEmail: { limit: 5, windowSeconds: 15 * 60 },
} as const;

const schema = z.object({
  email: z.string().max(254),
  password: z.string().min(1, "Enter your password").max(PASSWORD_RULES.max),
});

/** A hash to compare against when the email is unknown, so both cases take the same time. */
let decoy: Promise<string> | null = null;

const WRONG = () =>
  new AppError(
    "VALIDATION",
    "Wrong email or password. Had an account before the relaunch? Please sign up again.",
    { password: ["Wrong email or password"] },
  );

/**
 * Email + password login (staff: DECISIONS M18; players who signed up with a password: M38). Only
 * accounts with a password and a verified email can use it; the answer is the same for an unknown
 * email, an account without a password and a wrong password.
 */
export async function loginWithPassword(
  input: unknown,
  ip: string,
): Promise<{ id: string; profileComplete: boolean }> {
  const { email: raw, password } = parseInput(schema, input);
  const email = normalizeEmail(raw);
  if (!email) throw WRONG();
  const rate = "Too many login attempts. Please wait 15 minutes and try again.";
  await enforceRateLimit(
    `password:ip:${ip}`,
    PASSWORD_RATE_LIMITS.perIp.limit,
    PASSWORD_RATE_LIMITS.perIp.windowSeconds,
    rate,
  );
  await enforceRateLimit(
    `password:${email}`,
    PASSWORD_RATE_LIMITS.perEmail.limit,
    PASSWORD_RATE_LIMITS.perEmail.windowSeconds,
    rate,
  );

  const user = await db.user.findUnique({
    where: { email },
    include: { gameProfiles: { select: { game: true } } },
  });
  const stored = user?.passwordHash && user.emailVerifiedAt ? user.passwordHash : null;
  decoy ??= hashPassword("decoy-password-never-matches");
  const ok = await verifyPassword(password, stored ?? (await decoy));
  if (!user || !stored || !ok) throw WRONG();

  await assertPhoneNotBanned(user.phone, user.email);
  assertAccountCanLogIn(user);
  return { id: user.id, profileComplete: isProfileComplete(user) };
}
