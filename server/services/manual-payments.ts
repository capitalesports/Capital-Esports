import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UpiApp } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/providers/storage";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { checkImage, IMAGE_EXTENSION, MB, SCREENSHOT_MAX_BYTES } from "@/lib/image";
import {
  MANUAL_PAYMENT_PROOF_MINUTES,
  normalizeTransactionId,
  UPI_APPS,
} from "@/lib/manual-payments";
import { assertAdmin, assertUser, type Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { notify, type NotificationEvent } from "./notify";

/**
 * Manual UPI payments (DECISIONS M54). A paid match with an uploaded UPI QR takes payment by QR:
 * the player pays, uploads the transaction ID and a screenshot, and an admin approves it. Approval
 * records a PAID Payment (so refunds, reports and referral rewards treat it like any payment) and
 * confirms the slot; the "Slot confirmed" email goes out only then.
 */

export const QR_MAX_BYTES = 2 * MB;

/** Statuses in which the player may (still) upload proof. */
const PROOF_OPEN = ["AWAITING_PROOF", "REJECTED"] as const;

/** Inside the registration transaction: hold the slot while the player pays the QR. */
export async function holdForManualPayment(
  tx: Tx,
  reg: { id: string; userId: string },
  match: { id: string; entryFeePaise: number },
  now = new Date(),
) {
  const earlier = await tx.manualPayment.findUnique({ where: { registrationId: reg.id } });
  if (earlier?.status === "APPROVED") {
    // Already paid and approved (e.g. moved back into a slot): no second payment.
    await tx.registration.update({
      where: { id: reg.id },
      data: { status: "CONFIRMED", cancelledAt: null },
    });
    return earlier;
  }
  await tx.registration.update({
    where: { id: reg.id },
    data: { status: "PENDING_PAYMENT", cancelledAt: null },
  });
  const data = {
    userId: reg.userId,
    matchId: match.id,
    amountPaise: match.entryFeePaise,
    status: "AWAITING_PROOF" as const,
    app: null,
    transactionId: null,
    screenshotUrl: null,
    submittedAt: null,
    reviewedById: null,
    reviewedAt: null,
    rejectReason: null,
    expiresAt: addMinutes(now, MANUAL_PAYMENT_PROOF_MINUTES),
  };
  return tx.manualPayment.upsert({
    where: { registrationId: reg.id },
    create: { ...data, registrationId: reg.id },
    update: data,
  });
}

const submitSchema = z.object({
  matchId: z.string().min(1),
  app: z.enum(UPI_APPS, { message: "Choose the app you paid with" }),
  transactionId: z.string().transform((v, ctx) => {
    const id = normalizeTransactionId(v);
    if (!id) {
      ctx.addIssue({
        code: "custom",
        message: "Enter the transaction ID / UPI reference (6–35 letters or digits)",
      });
      return z.NEVER;
    }
    return id;
  }),
});

/** The player's proof: app, transaction ID and a screenshot of the payment. */
export async function submitManualPayment(
  actor: Actor | null,
  input: unknown,
  screenshot: Uint8Array | null,
  now = new Date(),
) {
  const me = assertUser(actor);
  const data = parseInput(submitSchema, input);
  const check = checkImage(screenshot ?? new Uint8Array(), SCREENSHOT_MAX_BYTES);
  if (!check.ok) throw new AppError("VALIDATION", check.error, { screenshot: [check.error] });
  await enforceRateLimit(
    `manualpay:${me.id}`,
    10,
    60 * 60,
    "Too many payment uploads. Please wait an hour and try again.",
  );

  const current = await db.manualPayment.findFirst({
    where: { matchId: data.matchId, userId: me.id, registration: { userId: me.id } },
  });
  if (!current)
    throw new AppError("NOT_FOUND", "There is no payment waiting for you in this match.");
  if (current.status === "SUBMITTED")
    throw new AppError("CONFLICT", "Your payment is already waiting for approval.");
  if (current.status === "APPROVED") throw new AppError("CONFLICT", "This entry is already paid.");
  if (!(PROOF_OPEN as readonly string[]).includes(current.status) || current.expiresAt <= now) {
    throw new AppError(
      "CONFLICT",
      "The time to upload your payment has run out. Register again if slots are left.",
    );
  }

  const key = `payments/${data.matchId}/${randomUUID()}.${IMAGE_EXTENSION[check.mime]}`;
  const screenshotUrl = await getStorage().put(key, screenshot!, check.mime);

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${data.matchId} FOR UPDATE`;
    const row = await tx.manualPayment.findUniqueOrThrow({ where: { id: current.id } });
    const reg = await tx.registration.findUniqueOrThrow({ where: { id: row.registrationId } });
    if (reg.status !== "PENDING_PAYMENT" || !(PROOF_OPEN as readonly string[]).includes(row.status))
      throw new AppError("CONFLICT", "This entry is no longer waiting for payment.");
    // One transaction ID pays for one entry.
    const reused = await tx.manualPayment.findFirst({
      where: {
        transactionId: data.transactionId,
        status: { in: ["SUBMITTED", "APPROVED"] },
        id: { not: row.id },
      },
      select: { id: true },
    });
    if (reused) {
      throw new AppError(
        "CONFLICT",
        "This transaction ID has already been used for another entry.",
        {
          transactionId: ["Already used"],
        },
      );
    }
    await tx.manualPayment.update({
      where: { id: row.id },
      data: {
        status: "SUBMITTED",
        app: data.app as UpiApp,
        transactionId: data.transactionId,
        screenshotUrl,
        submittedAt: now,
        rejectReason: null,
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "manualPayment.submit",
      entityType: "ManualPayment",
      entityId: row.id,
      after: { app: data.app, transactionId: data.transactionId, amountPaise: row.amountPaise },
    });
  });
  return { status: "SUBMITTED" as const };
}

/** Players who play under a registration (registrant + roster players with accounts). */
async function playersOf(tx: Tx, reg: { id: string; userId: string }) {
  const roster = await tx.registrationMember.findMany({
    where: { registrationId: reg.id, status: "CONFIRMED" },
    select: { userId: true },
  });
  return [...new Set([reg.userId, ...roster.flatMap((r) => (r.userId ? [r.userId] : []))])];
}

const idSchema = z.object({ manualPaymentId: z.string().min(1) });

/** Admin: the money arrived. Records a PAID payment and confirms the slot (and only now emails). */
export async function approveManualPayment(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertAdmin(actor);
  const { manualPaymentId } = parseInput(idSchema, input);
  const events: NotificationEvent[] = [];
  await db.$transaction(async (tx) => {
    const found = await tx.manualPayment.findUnique({ where: { id: manualPaymentId } });
    if (!found) throw new AppError("NOT_FOUND", "Payment not found.");
    await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${found.matchId} FOR UPDATE`;
    const row = await tx.manualPayment.findUniqueOrThrow({ where: { id: manualPaymentId } });
    if (row.status !== "SUBMITTED")
      throw new AppError("CONFLICT", "Only payments waiting for approval can be approved.");
    const reg = await tx.registration.findUniqueOrThrow({ where: { id: row.registrationId } });
    const match = await tx.match.findUniqueOrThrow({
      where: { id: row.matchId },
      select: { id: true, isEntryList: true, status: true, registrationClosesAt: true },
    });
    if (reg.status !== "PENDING_PAYMENT")
      throw new AppError("CONFLICT", "This entry is no longer waiting for payment.");
    // Tournament lobbies/brackets are drawn when sign-ups close: a late approval would be left out.
    if (
      match.isEntryList &&
      (match.status !== "REGISTRATION_OPEN" || now >= match.registrationClosesAt)
    ) {
      throw new AppError(
        "CONFLICT",
        "Sign-ups for this tournament have closed and the draw is done. Reject it and refund the player.",
      );
    }
    const payment = await tx.payment.upsert({
      where: { registrationId: reg.id },
      create: {
        userId: reg.userId,
        matchId: row.matchId,
        registrationId: reg.id,
        orderId: `manual_${row.id}`,
        amountPaise: row.amountPaise,
        status: "PAID",
        cfPaymentId: row.transactionId,
        paidAt: now,
        expiresAt: now,
      },
      update: {
        orderId: `manual_${row.id}`,
        amountPaise: row.amountPaise,
        status: "PAID",
        cfPaymentId: row.transactionId,
        paidAt: now,
      },
    });
    await tx.registration.update({
      where: { id: reg.id },
      data: { status: "CONFIRMED", paymentId: payment.id },
    });
    await tx.manualPayment.update({
      where: { id: row.id },
      data: { status: "APPROVED", reviewedById: me.id, reviewedAt: now },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "manualPayment.approve",
      entityType: "ManualPayment",
      entityId: row.id,
      before: { status: row.status },
      after: { status: "APPROVED", paymentId: payment.id, transactionId: row.transactionId },
    });
    events.push({
      type: "REGISTRATION_CONFIRMED",
      userIds: await playersOf(tx, reg),
      matchId: row.matchId,
    });
  });
  await Promise.all(events.map(notify));
  return { approved: true };
}

const rejectSchema = idSchema.extend({
  reason: z.string().trim().min(3, "Give a reason the player will see").max(200),
  /** Free the slot now instead of letting the player upload again. */
  release: z.boolean().default(false),
});

/** Admin: the payment wasn't found or doesn't match. The player may upload again (or the slot frees). */
export async function rejectManualPayment(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertAdmin(actor);
  const { manualPaymentId, reason, release } = parseInput(rejectSchema, input);
  const events: NotificationEvent[] = [];
  await db.$transaction(async (tx) => {
    const found = await tx.manualPayment.findUnique({ where: { id: manualPaymentId } });
    if (!found) throw new AppError("NOT_FOUND", "Payment not found.");
    await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${found.matchId} FOR UPDATE`;
    const row = await tx.manualPayment.findUniqueOrThrow({ where: { id: manualPaymentId } });
    if (row.status !== "SUBMITTED")
      throw new AppError("CONFLICT", "Only payments waiting for approval can be rejected.");
    const reg = await tx.registration.findUniqueOrThrow({ where: { id: row.registrationId } });
    await tx.manualPayment.update({
      where: { id: row.id },
      data: {
        status: release ? "EXPIRED" : "REJECTED",
        rejectReason: reason,
        reviewedById: me.id,
        reviewedAt: now,
        // Another 30 minutes to upload the right proof.
        expiresAt: addMinutes(now, MANUAL_PAYMENT_PROOF_MINUTES),
      },
    });
    if (release && reg.status === "PENDING_PAYMENT") await releaseSlot(tx, reg.id, now);
    await writeAudit(tx, {
      actorId: me.id,
      action: "manualPayment.reject",
      entityType: "ManualPayment",
      entityId: row.id,
      before: { status: row.status },
      after: { status: release ? "EXPIRED" : "REJECTED", reason, released: release },
    });
    events.push({
      type: "PAYMENT_REJECTED",
      userIds: [reg.userId],
      matchId: row.matchId,
      reason,
      released: release,
    });
  });
  await Promise.all(events.map(notify));
  return { rejected: true };
}

/** Cancel a waiting entry and let the next waitlisted entry in. */
async function releaseSlot(tx: Tx, registrationId: string, now: Date) {
  const reg = await tx.registration.update({
    where: { id: registrationId },
    data: { status: "CANCELLED", cancelledAt: now },
  });
  await tx.registrationMember.deleteMany({ where: { registrationId } });
  const { lockMatch, promoteWaitlist } = await import("./registration");
  const match = await lockMatch(tx, reg.matchId);
  await promoteWaitlist(tx, match);
}

/**
 * Entries whose player never uploaded (accepted) proof in time lose the slot. Proof waiting for an
 * admin never expires. Runs from the status catch-up; safe to repeat.
 */
export async function expireManualPayments(now = new Date()) {
  const due = await db.manualPayment.findMany({
    where: { status: { in: [...PROOF_OPEN] }, expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: 200,
    select: { id: true, registrationId: true, matchId: true },
  });
  let expired = 0;
  for (const p of due) {
    try {
      const done = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${p.matchId} FOR UPDATE`;
        const row = await tx.manualPayment.findUniqueOrThrow({ where: { id: p.id } });
        if (!(PROOF_OPEN as readonly string[]).includes(row.status) || row.expiresAt > now)
          return false;
        await tx.manualPayment.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
        const reg = await tx.registration.findUnique({ where: { id: p.registrationId } });
        if (reg?.status === "PENDING_PAYMENT") await releaseSlot(tx, reg.id, now);
        return true;
      });
      if (done) expired++;
    } catch (e) {
      console.error("[manual-payment-expiry] failed for", p.id, e);
    }
  }
  return { expired };
}

/** Admin list: waiting for approval first (oldest first), then recent decisions. */
export async function listManualPayments(actor: Actor | null) {
  assertAdmin(actor);
  const select = {
    id: true,
    status: true,
    amountPaise: true,
    app: true,
    transactionId: true,
    screenshotUrl: true,
    submittedAt: true,
    reviewedAt: true,
    rejectReason: true,
    user: { select: { id: true, displayName: true } },
    reviewedBy: { select: { displayName: true } },
    registration: { select: { teamName: true, team: { select: { name: true } } } },
    match: {
      select: {
        id: true,
        title: true,
        game: true,
        startsAt: true,
        registrationClosesAt: true,
        isEntryList: true,
        tournament: { select: { title: true } },
      },
    },
  } as const;
  const [waiting, decided] = await Promise.all([
    db.manualPayment.findMany({
      where: { status: "SUBMITTED" },
      orderBy: { submittedAt: "asc" },
      take: 200,
      select,
    }),
    db.manualPayment.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { reviewedAt: "desc" },
      take: 50,
      select,
    }),
  ]);
  return { waiting, decided };
}

/** Admin: upload (or remove) the UPI QR that a match or tournament takes its entry fee with. */
export async function setPaymentQr(actor: Actor | null, input: unknown, qr: Uint8Array | null) {
  const me = assertAdmin(actor);
  const { matchId, tournamentId, remove } = parseInput(
    z
      .object({
        matchId: z.string().min(1).optional(),
        tournamentId: z.string().min(1).optional(),
        remove: z.boolean().default(false),
      })
      .refine((v) => !!v.matchId !== !!v.tournamentId, "Give a match or a tournament"),
    input,
  );
  const target = tournamentId
    ? (
        await db.tournament.findUnique({
          where: { id: tournamentId },
          select: { entryMatchId: true },
        })
      )?.entryMatchId
    : matchId;
  const match = target ? await db.match.findUnique({ where: { id: target } }) : null;
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  let url: string | null = null;
  if (!remove) {
    const check = checkImage(qr ?? new Uint8Array(), QR_MAX_BYTES);
    if (!check.ok) throw new AppError("VALIDATION", check.error, { qr: [check.error] });
    url = await getStorage().put(
      `payment-qr/${match.id}/${randomUUID()}.${IMAGE_EXTENSION[check.mime]}`,
      qr!,
      check.mime,
    );
  }
  await db.$transaction(async (tx) => {
    await tx.match.update({ where: { id: match.id }, data: { paymentQrUrl: url } });
    await writeAudit(tx, {
      actorId: me.id,
      action: url ? "match.paymentQr.set" : "match.paymentQr.remove",
      entityType: "Match",
      entityId: match.id,
      before: { paymentQrUrl: match.paymentQrUrl },
      after: { paymentQrUrl: url },
    });
  });
  return { matchId: match.id, paymentQrUrl: url };
}
