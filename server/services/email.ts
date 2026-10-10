import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { sessionSecret, siteUrlServer } from "@/server/env";
import { AppError } from "@/server/errors";
import { getEmailSender, renderEmail } from "@/server/providers/email";
import { consumeRateLimit, enforceRateLimit, peekRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { normalizeEmail } from "@/lib/input-rules";
import { SITE_NAME } from "@/lib/site";
import { isProfileComplete } from "@/lib/profile";
import { assertUser, type Actor } from "@/lib/roles";
import { assertAccountCanLogIn, assertPhoneNotBanned } from "./auth";

/** Codes are 6 digits, valid 10 minutes, 5 wrong tries, one use. */
export const EMAIL_CODE = { ttlMinutes: 10, maxAttempts: 5 } as const;
export const EMAIL_RATE_LIMITS = {
  perEmail: { limit: 3, windowSeconds: 15 * 60 },
  perIp: { limit: 20, windowSeconds: 15 * 60 },
  perUser: { limit: 5, windowSeconds: 60 * 60 },
} as const;

export const emailField = z.string().transform((v, ctx) => {
  const email = normalizeEmail(v);
  if (!email) {
    ctx.addIssue({ code: "custom", message: "Enter a valid email address" });
    return z.NEVER;
  }
  return email;
});
export const codeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

function hashCode(code: string): string {
  return createHash("sha256").update(`${sessionSecret()}:email-code:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function sendCode(
  user: { id: string },
  email: string,
  purpose: "VERIFY" | "LOGIN",
): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // A new code replaces any earlier unused one for the same purpose.
  await db.emailCode.updateMany({
    where: { userId: user.id, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.emailCode.create({
    data: {
      userId: user.id,
      email,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + EMAIL_CODE.ttlMinutes * 60_000),
    },
  });
  const title = purpose === "LOGIN" ? "Your login code" : "Verify your email";
  const body =
    purpose === "LOGIN"
      ? `Your ${SITE_NAME} login code is ${code}. It expires in ${EMAIL_CODE.ttlMinutes} minutes. If you didn't try to log in, ignore this email.`
      : `Your code to verify this email on ${SITE_NAME} is ${code}. It expires in ${EMAIL_CODE.ttlMinutes} minutes.`;
  await getEmailSender().send({
    to: email,
    subject: `${code} is your ${title.toLowerCase()}`,
    ...renderEmail({ title, body }),
  });
}

/** Wrong codes per email across all its codes in a day: new codes don't reset the count. */
export const CODE_FAILURES_PER_DAY = 10;
const codeFailKey = (email: string) => `email:codefail:${email}`;

/** Check a code; wrong codes count towards the attempt limit. Returns the matched code row. */
export async function consumeCode(where: Prisma.EmailCodeWhereInput, code: string) {
  const row = await db.emailCode.findFirst({
    where: { ...where, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const invalid = new AppError(
    "VALIDATION",
    "That code is wrong or has expired. Request a new one.",
    {
      code: ["Wrong or expired code"],
    },
  );
  if (!row || row.expiresAt < new Date() || row.attempts >= EMAIL_CODE.maxAttempts) throw invalid;
  if ((await peekRateLimit(codeFailKey(row.email), 86_400)) >= CODE_FAILURES_PER_DAY) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many wrong codes for this email. Please try again tomorrow.",
    );
  }
  if (!sameHash(row.codeHash, hashCode(code))) {
    await db.emailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    await consumeRateLimit(codeFailKey(row.email), CODE_FAILURES_PER_DAY, 86_400);
    throw invalid;
  }
  // Conditional update: two requests with the same code can't both succeed.
  const { count } = await db.emailCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!count) throw invalid;
  return row;
}

/**
 * An email held by an email+password sign-up that never entered its code was never proven, so
 * whoever does prove it (Google, or verifying it on a profile) takes it over (DECISIONS M38).
 */
export async function releaseUnprovenEmail(email: string): Promise<void> {
  await db.user.updateMany({
    where: { email, emailVerifiedAt: null, googleId: null, phone: null },
    data: { email: null },
  });
}

// ---------------------------------------------------------------------------
// Verifying an email on the profile
// ---------------------------------------------------------------------------

/** Send a verification code to a new email for the logged-in player. */
export async function requestEmailVerification(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { email } = parseInput(z.object({ email: emailField }), input);
  await enforceRateLimit(
    `email:user:${me.id}`,
    EMAIL_RATE_LIMITS.perUser.limit,
    EMAIL_RATE_LIMITS.perUser.windowSeconds,
    "Too many codes requested. Try again in an hour.",
  );
  const owner = await db.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, googleId: true, phone: true },
  });
  const unproven = owner && !owner.emailVerifiedAt && !owner.googleId && !owner.phone;
  if (owner && owner.id !== me.id && !unproven) {
    throw new AppError("CONFLICT", "That email is already used by another account.", {
      email: ["Already used by another account"],
    });
  }
  await sendCode(me, email, "VERIFY");
  return { email };
}

/** Confirm the code: the email becomes the account's verified email. */
export async function confirmEmailVerification(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { code } = parseInput(z.object({ code: codeField }), input);
  const row = await consumeCode({ userId: me.id, purpose: "VERIFY" }, code);
  await releaseUnprovenEmail(row.email);
  const before = await db.user.findUniqueOrThrow({ where: { id: me.id }, select: { email: true } });
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: { email: row.email, emailVerifiedAt: new Date() },
      });
      await writeAudit(tx, {
        actorId: me.id,
        action: "user.email.verify",
        entityType: "User",
        entityId: me.id,
        before,
        after: { email: row.email },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", "That email is already used by another account.");
    }
    throw e;
  }
  return { email: row.email };
}

export async function removeEmail(actor: Actor | null) {
  const me = assertUser(actor);
  await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { email: true },
    });
    await tx.user.update({ where: { id: me.id }, data: { email: null, emailVerifiedAt: null } });
    await tx.emailCode.updateMany({
      where: { userId: me.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.email.remove",
      entityType: "User",
      entityId: me.id,
      before,
      after: { email: null },
    });
  });
}

export async function setEmailOptIn(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { optIn } = parseInput(z.object({ optIn: z.boolean() }), input);
  await db.user.update({ where: { id: me.id }, data: { emailOptIn: optIn } });
}

// ---------------------------------------------------------------------------
// Logging in with a verified email
// ---------------------------------------------------------------------------

/**
 * Email a login code. Only accounts with this email verified can log in by email. The answer is the same whether or not the email is known, so it can't be
 * used to find out who has an account.
 */
export async function requestEmailLogin(input: unknown, ip: string) {
  const { email } = parseInput(z.object({ email: emailField }), input);
  const rate = "Too many codes requested. Please wait 15 minutes and try again.";
  await enforceRateLimit(
    `email:login:ip:${ip}`,
    EMAIL_RATE_LIMITS.perIp.limit,
    EMAIL_RATE_LIMITS.perIp.windowSeconds,
    rate,
  );
  await enforceRateLimit(
    `email:login:${email}`,
    EMAIL_RATE_LIMITS.perEmail.limit,
    EMAIL_RATE_LIMITS.perEmail.windowSeconds,
    rate,
  );
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, deletedAt: true, role: true },
  });
  // Staff log in with their password only: an emailed 6-digit code is too weak for admin access.
  if (user?.emailVerifiedAt && !user.deletedAt && user.role === "PLAYER")
    await sendCode(user, email, "LOGIN");
  return { email };
}

/** Exchange an emailed login code for the account (same ban/merge checks as phone login). */
export async function loginWithEmailCode(
  input: unknown,
): Promise<{ id: string; isNew: false; profileComplete: boolean }> {
  const { email, code } = parseInput(z.object({ email: emailField, code: codeField }), input);
  await consumeCode({ email, purpose: "LOGIN" }, code);
  const user = await db.user.findUnique({
    where: { email },
    include: { gameProfiles: { select: { game: true } } },
  });
  if (!user?.emailVerifiedAt || user.role !== "PLAYER")
    throw new AppError("VALIDATION", "That code is wrong or has expired.");
  await assertPhoneNotBanned(user.phone);
  assertAccountCanLogIn(user);
  return { id: user.id, isNew: false, profileComplete: isProfileComplete(user) };
}

/** Absolute link for emails ("/scrims/abc" → "https://site/scrims/abc"). */
export function absoluteUrl(path: string): string {
  return /^https?:\/\//.test(path)
    ? path
    : `${siteUrlServer()}${path.startsWith("/") ? path : `/${path}`}`;
}
