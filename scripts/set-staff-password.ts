/**
 * Give a staff account (admin/moderator) an email + password login (DECISIONS M18).
 *
 *   $env:STAFF_PASSWORD = "..."; npx tsx scripts/set-staff-password.ts --phone +919876543210 --email you@example.com
 *
 * The password comes from STAFF_PASSWORD (never a command-line argument) and only its scrypt hash is
 * stored. The email is set as the account's verified email. Writes an AuditLog entry.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { normalizeEmail } from "../lib/input-rules";
import { hashPassword, PASSWORD_RULES } from "../lib/password-hash";
import { normalizePhone } from "../lib/validators";

const { values } = parseArgs({ options: { phone: { type: "string" }, email: { type: "string" } } });
const phone = normalizePhone(values.phone ?? process.env.ADMIN_PHONE ?? "");
const email = normalizeEmail(values.email ?? "");
const password = process.env.STAFF_PASSWORD ?? "";

function fail(message: string): never {
  console.error(`set-staff-password: ${message}`);
  process.exit(1);
}

if (!phone) fail("pass --phone (or set ADMIN_PHONE).");
if (!email) fail("pass a valid --email.");
if (password.length < PASSWORD_RULES.min || password.length > PASSWORD_RULES.max) {
  fail(`set STAFF_PASSWORD (${PASSWORD_RULES.min}-${PASSWORD_RULES.max} characters).`);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
try {
  const user = await db.user.findUnique({ where: { phone } });
  if (!user || user.deletedAt) fail("no account with that phone.");
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") fail("that account is not staff.");
  const other = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== user.id) fail("that email belongs to another account.");

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        email,
        emailVerifiedAt: user.email === email && user.emailVerifiedAt ? user.emailVerifiedAt : new Date(),
        passwordHash: await hashPassword(password),
      },
    }),
    db.auditLog.create({
      data: {
        actorId: user.id,
        action: "user.staffPassword.set",
        entityType: "User",
        entityId: user.id,
        before: { email: user.email, hadPassword: !!user.passwordHash },
        after: { email, hadPassword: true },
      },
    }),
  ]);
  console.log(`set-staff-password: ${user.role.toLowerCase()} ${email} can now log in with a password.`);
} finally {
  await db.$disconnect();
}
