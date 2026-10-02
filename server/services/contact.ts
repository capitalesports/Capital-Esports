import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { assertAdmin, type Actor } from "@/lib/roles";

export const CONTACT_LIMIT = { limit: 3, windowSeconds: 3600 };

const contactSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name").max(60),
  contact: z.string().trim().min(5, "Phone, email or Discord so we can reply").max(100),
  message: z.string().trim().min(10, "Write at least 10 characters").max(2000),
  /** Honeypot: real users never fill this hidden field. */
  website: z.string().max(0).optional(),
});

/** Public contact form. Rate-limited per IP; stores to ContactMessage for admins. */
export async function submitContactMessage(input: unknown, ip: string, userId: string | null) {
  const data = parseInput(contactSchema, input);
  await enforceRateLimit(
    `contact:${ip}`,
    CONTACT_LIMIT.limit,
    CONTACT_LIMIT.windowSeconds,
    "You have sent several messages. Please try again in an hour.",
  );
  return db.contactMessage.create({
    data: { name: data.name, contact: data.contact, message: data.message, userId },
  });
}

export async function listContactMessages(actor: Actor | null) {
  assertAdmin(actor);
  return db.contactMessage.findMany({
    where: { handled: false },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function markContactHandled(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { id } = parseInput(z.object({ id: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const before = await tx.contactMessage.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Message not found.");
    await tx.contactMessage.update({ where: { id }, data: { handled: true } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "contact.handled",
      entityType: "ContactMessage",
      entityId: id,
    });
  });
}
