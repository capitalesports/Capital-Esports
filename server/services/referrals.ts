import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  normalizeReferralCode,
  periodStart,
  FREE_SLOT_MAX_FEE_PAISE,
  REFERRAL_MIN_QUALIFYING_FEE_PAISE,
  referralRewards,
  REFERRAL_CLAIM_WINDOW_HOURS,
  REFERRAL_PERIODS,
  referralCodeFor,
  summarizeReferrals,
  type ReferredPlayer,
} from "@/lib/referral";
import { assertAdmin, assertUser, type Actor } from "@/lib/roles";
import { notify, type NotificationEvent } from "./notify";
import { csvCell } from "./seasons";

/** A booked slot: the registration holds (or held) a confirmed place. */
const BOOKED = ["CONFIRMED", "NO_SHOW"] as const;

/** The player's referral code, created on first use. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true, displayName: true },
  });
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = referralCodeFor(user.displayName);
    try {
      // Only set it if no other request set one meanwhile.
      const { count } = await db.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: code },
      });
      if (count) return code;
      return (await db.user.findUniqueOrThrow({ where: { id: userId } })).referralCode!;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new AppError("CONFLICT", "Could not create a referral code. Please try again.");
}

/**
 * Credit a brand-new account to the player whose code it came with (link or typed code). Only once,
 * only within 24 hours of the account being created, never to oneself or to a banned or deleted
 * account. Returns the referrer's id, or null when nothing was recorded.
 */
export async function claimReferral(
  userId: string,
  rawCode: unknown,
  now = new Date(),
): Promise<string | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { referredById: true, createdAt: true, deletedAt: true },
    });
    if (!user || user.referredById || user.deletedAt) return null;
    if (now.getTime() - user.createdAt.getTime() > REFERRAL_CLAIM_WINDOW_HOURS * 3_600_000)
      return null;
    const referrer = await tx.user.findUnique({
      where: { referralCode: code },
      select: { id: true, deletedAt: true, bannedAt: true },
    });
    if (!referrer || referrer.id === userId || referrer.deletedAt || referrer.bannedAt) return null;
    const { count } = await tx.user.updateMany({
      where: { id: userId, referredById: null },
      data: { referredById: referrer.id, referredAt: now },
    });
    if (!count) return null;
    await writeAudit(tx, {
      actorId: userId,
      action: "referral.claim",
      entityType: "User",
      entityId: userId,
      after: { referrerId: referrer.id, code },
    });
    return referrer.id;
  });
}

/** Activity of referred players (optionally only since a date), keyed by player. */
async function referredActivity(where: Prisma.UserWhereInput, since: Date | null) {
  const users = await db.user.findMany({
    where: { AND: [where, { referredById: { not: null }, deletedAt: null }] },
    select: { id: true, referredById: true, referredAt: true, displayName: true },
    orderBy: { referredAt: "desc" },
  });
  const ids = users.map((u) => u.id);
  const [slots, paid] = await Promise.all([
    db.registration.groupBy({
      by: ["userId"],
      where: {
        userId: { in: ids },
        status: { in: [...BOOKED] },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    }),
    db.payment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: ids },
        status: "PAID",
        ...(since ? { paidAt: { gte: since } } : {}),
      },
      _count: { _all: true },
      _sum: { amountPaise: true },
      _max: { paidAt: true },
    }),
  ]);
  const slotsBy = new Map(slots.map((s) => [s.userId, s._count._all]));
  const paidBy = new Map(paid.map((p) => [p.userId, p]));
  const players: (ReferredPlayer & { name: string; joinedAt: Date | null })[] = users.map((u) => {
    const p = paidBy.get(u.id);
    return {
      userId: u.id,
      referrerId: u.referredById!,
      name: u.displayName ?? "Player",
      joinedAt: u.referredAt,
      slots: slotsBy.get(u.id) ?? 0,
      paidSlots: p?._count._all ?? 0,
      paidPaise: p?._sum.amountPaise ?? 0,
      lastPaidAt: p?._max.paidAt ?? null,
    };
  });
  return players;
}

/**
 * The player's free slots (M52): earned from referred players with a paid slot, minus the ones used
 * on entries that still stand (a cancelled entry gives its free slot back).
 */
export async function referralRewardsFor(reader: Tx | typeof db, userId: string) {
  const [paidPlayers, used] = await Promise.all([
    reader.user.count({
      where: {
        referredById: userId,
        deletedAt: null,
        bannedAt: null,
        // Counted once the match was actually played: entries refunded by a cancelled match never earn.
        payments: {
          some: {
            status: "PAID",
            amountPaise: { gte: REFERRAL_MIN_QUALIFYING_FEE_PAISE },
            match: { status: { in: ["LIVE", "RESULTS_PENDING", "COMPLETED"] } },
          },
        },
      },
    }),
    reader.referralCreditUse.count({
      where: { userId, registration: { status: { not: "CANCELLED" } } },
    }),
  ]);
  return referralRewards(paidPlayers, used);
}

/**
 * Spend a free slot on my entry that is waiting for payment: the entry is confirmed without paying.
 * If the gateway payment completes anyway, the real payment wins and the free slot comes back.
 */
export async function redeemReferralCredit(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertUser(actor);
  const { matchId } = parseInput(z.object({ matchId: z.string().min(1) }), input);
  const events: NotificationEvent[] = [];
  await db.$transaction(async (tx) => {
    // Same lock order as the payment webhook (match row), plus one per player for the credit count.
    await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"refcredit:" + me.id}))`;
    const reg = await tx.registration.findUnique({
      where: { matchId_userId: { matchId, userId: me.id } },
      include: {
        match: { select: { entryFeePaise: true, status: true, registrationClosesAt: true } },
      },
    });
    if (!reg || reg.status !== "PENDING_PAYMENT")
      throw new AppError("NOT_FOUND", "There is no payment waiting for you in this match.");
    const payment = reg.paymentId
      ? await tx.payment.findUnique({ where: { id: reg.paymentId } })
      : null;
    if (payment?.status === "PAID") throw new AppError("CONFLICT", "This entry is already paid.");
    // Paid by UPI QR (M54): a free slot replaces the QR payment while no proof is waiting for review.
    const manual = await tx.manualPayment.findUnique({ where: { registrationId: reg.id } });
    if (manual) {
      if (manual.status === "SUBMITTED")
        throw new AppError("CONFLICT", "Your payment proof is waiting for approval.");
      if (manual.expiresAt <= now)
        throw new AppError(
          "CONFLICT",
          "The payment window has expired. Register again if slots are left.",
        );
    } else if (!payment || payment.expiresAt <= now)
      throw new AppError(
        "CONFLICT",
        "The payment window has expired. Register again if slots are left.",
      );
    if (reg.match.status !== "REGISTRATION_OPEN" || now >= reg.match.registrationClosesAt) {
      throw new AppError("CONFLICT", "Registration for this match has closed.");
    }
    if (reg.match.entryFeePaise > FREE_SLOT_MAX_FEE_PAISE) {
      throw new AppError(
        "CONFLICT",
        `Free slots cover entries up to ₹${FREE_SLOT_MAX_FEE_PAISE / 100}. Please pay for this one.`,
      );
    }
    const rewards = await referralRewardsFor(tx, me.id);
    if (rewards.available < 1) throw new AppError("CONFLICT", "You have no free slots yet.");
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    if (manual) await tx.manualPayment.delete({ where: { id: manual.id } });
    await tx.registration.update({ where: { id: reg.id }, data: { status: "CONFIRMED" } });
    await tx.referralCreditUse.create({
      data: {
        userId: me.id,
        registrationId: reg.id,
        matchId,
        valuePaise: reg.match.entryFeePaise,
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "referral.redeem",
      entityType: "Registration",
      entityId: reg.id,
      after: { matchId, valuePaise: reg.match.entryFeePaise, availableBefore: rewards.available },
    });
    events.push({ type: "REGISTRATION_CONFIRMED", userIds: [me.id], matchId });
  });
  await Promise.all(events.map(notify));
  return { confirmed: true };
}

/** "Refer friends" page: the player's code and the players who joined with it (no amounts). */
export async function getMyReferrals(actor: Actor | null) {
  const me = assertUser(actor);
  const code = await getOrCreateReferralCode(me.id);
  const [players, rewards] = await Promise.all([
    referredActivity({ referredById: me.id }, null),
    referralRewardsFor(db, me.id),
  ]);
  return {
    code,
    rewards,
    joined: players.length,
    booked: players.filter((p) => p.slots > 0).length,
    paidPlayers: players.filter((p) => p.paidSlots > 0).length,
    players: players.map((p) => ({
      name: p.name,
      joinedAt: p.joinedAt,
      booked: p.slots > 0,
      paid: p.paidSlots > 0,
    })),
  };
}

const periodSchema = z.object({
  period: z.enum(REFERRAL_PERIODS).catch("all"),
});

/** Admin report: one row per referrer. Slots and payments count within the chosen period. */
export async function listReferrers(actor: Actor | null, input: unknown = {}) {
  assertAdmin(actor);
  const { period } = parseInput(periodSchema, input ?? {});
  const players = await referredActivity({}, periodStart(period));
  const rows = summarizeReferrals(players);
  const referrers = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.referrerId) } },
    select: { id: true, displayName: true, referralCode: true, email: true },
  });
  const byId = new Map(referrers.map((r) => [r.id, r]));
  return rows.map((r) => ({
    ...r,
    name: byId.get(r.referrerId)?.displayName ?? "Player",
    code: byId.get(r.referrerId)?.referralCode ?? null,
    email: byId.get(r.referrerId)?.email ?? null,
  }));
}

/** Admin: the players one referrer brought in, each with their booked and paid slots. */
export async function getReferrerDetail(actor: Actor | null, input: unknown) {
  assertAdmin(actor);
  const { referrerId, period } = parseInput(
    periodSchema.extend({ referrerId: z.string().min(1) }),
    input,
  );
  const referrer = await db.user.findUnique({
    where: { id: referrerId },
    select: { id: true, displayName: true, referralCode: true, email: true },
  });
  if (!referrer) throw new AppError("NOT_FOUND", "Player not found.");
  const since = periodStart(period);
  const players = await referredActivity({ referredById: referrerId }, since);
  const payments = await db.payment.findMany({
    where: {
      userId: { in: players.map((p) => p.userId) },
      status: "PAID",
      ...(since ? { paidAt: { gte: since } } : {}),
    },
    orderBy: { paidAt: "desc" },
    select: {
      userId: true,
      amountPaise: true,
      paidAt: true,
      match: { select: { id: true, title: true, game: true, kind: true } },
    },
  });
  return {
    referrer: { ...referrer, name: referrer.displayName ?? "Player" },
    players: players.map((p) => ({
      ...p,
      payments: payments.filter((x) => x.userId === p.userId),
    })),
  };
}

/** CSV of the admin report (one line per referred player, with the referrer's details). */
export async function referralsCsv(actor: Actor | null, input: unknown = {}) {
  assertAdmin(actor);
  const { period } = parseInput(periodSchema, input ?? {});
  const players = await referredActivity({}, periodStart(period));
  const referrers = await db.user.findMany({
    where: { id: { in: [...new Set(players.map((p) => p.referrerId))] } },
    select: { id: true, displayName: true, referralCode: true },
  });
  const byId = new Map(referrers.map((r) => [r.id, r]));
  const head = [
    "referrer",
    "referrer_code",
    "player",
    "joined_at",
    "slots_booked",
    "paid_slots",
    "paid_rupees",
    "last_paid_at",
  ];
  const lines = players.map((p) =>
    [
      byId.get(p.referrerId)?.displayName ?? "Player",
      byId.get(p.referrerId)?.referralCode ?? "",
      p.name,
      p.joinedAt?.toISOString() ?? "",
      p.slots,
      p.paidSlots,
      (p.paidPaise / 100).toFixed(2),
      p.lastPaidAt?.toISOString() ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return { filename: `referrals-${period}.csv`, csv: [head.join(","), ...lines].join("\n") + "\n" };
}
