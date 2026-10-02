import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { DELETION_NOTE_MAX, DELETION_REASON_MAX } from "@/lib/input-rules";
import { assertAdmin, assertUser, type Actor } from "@/lib/roles";
import { notify } from "./notify";
import { eraseAccount } from "./profile";

/**
 * Account deletion by request (DECISIONS M39): a player asks, an admin approves (the account is
 * erased by `eraseAccount`) or rejects. A player has at most one pending request.
 */

const requestSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(DELETION_REASON_MAX, `Use at most ${DELETION_REASON_MAX} characters`)
    .optional()
    .transform((v) => v || null),
});
const decideSchema = z.object({
  requestId: z.string().min(1).max(50),
  note: z
    .string()
    .trim()
    .max(DELETION_NOTE_MAX, `Use at most ${DELETION_NOTE_MAX} characters`)
    .optional()
    .transform((v) => v || null),
});

/** My pending request, if any (shown on the profile). */
export async function getMyPendingDeletionRequest(userId: string) {
  return db.accountDeletionRequest.findFirst({
    where: { userId, status: "PENDING" },
    select: { id: true, createdAt: true, reason: true },
  });
}

/** Ask an admin to delete my account. Asking again while one is pending returns that one. */
export async function requestAccountDeletion(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { reason } = parseInput(requestSchema, input);
  return db.$transaction(async (tx) => {
    // Lock my user row so two clicks can't open two requests.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${me.id} FOR UPDATE`;
    const pending = await tx.accountDeletionRequest.findFirst({
      where: { userId: me.id, status: "PENDING" },
      select: { id: true },
    });
    if (pending) return pending;
    const created = await tx.accountDeletionRequest.create({
      data: { userId: me.id, reason },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.deletionRequest.create",
      entityType: "AccountDeletionRequest",
      entityId: created.id,
      after: { reason },
    });
    return created;
  });
}

/** Withdraw my pending request. */
export async function cancelAccountDeletionRequest(actor: Actor | null) {
  const me = assertUser(actor);
  await db.$transaction(async (tx) => {
    const pending = await tx.accountDeletionRequest.findFirst({
      where: { userId: me.id, status: "PENDING" },
      select: { id: true },
    });
    if (!pending) throw new AppError("NOT_FOUND", "You have no pending deletion request.");
    await tx.accountDeletionRequest.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "user.deletionRequest.cancel",
      entityType: "AccountDeletionRequest",
      entityId: pending.id,
    });
  });
}

/** Admin list: pending requests first (oldest first), then the latest decisions. */
export async function listDeletionRequests(actor: Actor | null) {
  assertAdmin(actor);
  const select = {
    id: true,
    reason: true,
    status: true,
    createdAt: true,
    decidedAt: true,
    adminNote: true,
    user: { select: { id: true, displayName: true, email: true, deletedAt: true } },
    decidedBy: { select: { displayName: true } },
  } as const;
  const [pending, decided] = await Promise.all([
    db.accountDeletionRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select,
    }),
    db.accountDeletionRequest.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { decidedAt: "desc" },
      take: 30,
      select,
    }),
  ]);
  return { pending, decided };
}

async function pendingRequest(requestId: string) {
  const req = await db.accountDeletionRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, status: true },
  });
  if (!req) throw new AppError("NOT_FOUND", "Deletion request not found.");
  if (req.status !== "PENDING") throw new AppError("CONFLICT", "This request was already handled.");
  return req;
}

/** Approve: erase the account, then close the request. */
export async function approveDeletionRequest(actor: Actor | null, input: unknown) {
  const admin = assertAdmin(actor);
  const { requestId, note } = parseInput(decideSchema, input);
  const req = await pendingRequest(requestId);
  await eraseAccount(req.userId, admin.id);
  await db.$transaction(async (tx) => {
    // Close every pending request of this player (there is at most one).
    await tx.accountDeletionRequest.updateMany({
      where: { userId: req.userId, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: admin.id, adminNote: note },
    });
    await writeAudit(tx, {
      actorId: admin.id,
      action: "user.deletionRequest.approve",
      entityType: "AccountDeletionRequest",
      entityId: req.id,
      after: { userId: req.userId, note },
    });
  });
}

/** Reject: the account stays; the player gets a notification with the admin's note. */
export async function rejectDeletionRequest(actor: Actor | null, input: unknown) {
  const admin = assertAdmin(actor);
  const { requestId, note } = parseInput(decideSchema, input);
  const req = await pendingRequest(requestId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.accountDeletionRequest.updateMany({
      where: { id: req.id, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date(), decidedById: admin.id, adminNote: note },
    });
    if (!count) throw new AppError("CONFLICT", "This request was already handled.");
    await writeAudit(tx, {
      actorId: admin.id,
      action: "user.deletionRequest.reject",
      entityType: "AccountDeletionRequest",
      entityId: req.id,
      after: { userId: req.userId, note },
    });
  });
  await notify({
    type: "ANNOUNCEMENT",
    userIds: [req.userId],
    title: "Account deletion request declined",
    body: note
      ? `Your request to delete your account was declined: ${note}`
      : "Your request to delete your account was declined. Contact support if you have questions.",
    url: "/profile",
  });
}
