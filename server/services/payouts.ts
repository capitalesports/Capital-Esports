import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  cashfreePayoutsConfig,
  isProductionDeployment,
  payoutTwoStepThresholdPaise,
} from "@/server/env";
import { AppError } from "@/server/errors";
import { getPayoutGateway } from "@/server/providers/payout-gateway";
import { parseInput } from "@/server/validation";
import { isHeadToHead } from "@/lib/match-modes";
import { rupeesToPaise } from "@/lib/money";
import {
  canMovePayout,
  isAdult,
  mapTransferStatus,
  maskVpa,
  needsSecondApproval,
  payoutMethodSchema,
} from "@/lib/payments";
import { assertAdmin, assertUser, type Actor } from "@/lib/roles";
import { formatIST, utcToIstInput } from "@/lib/time";
import { notify } from "./notify";
import { csvCell } from "./seasons";
import type { PublishedWinner } from "./tournaments";

export const MINOR_PAYOUT_MESSAGE =
  "Prize payouts to players under 18 need a parent or guardian account. Contact support and we will arrange the payout with your guardian.";

/** Prefix of a payout method saved without a mobile number: not registered with Cashfree (M33). */
export const UNREGISTERED_BENEFICIARY = "unregistered_";

/** Player adds/replaces where prizes are paid. Registered as a Cashfree beneficiary; only masked details stored. */
export async function savePayoutMethod(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const user = await db.user.findUniqueOrThrow({
    where: { id: me.id },
    select: { id: true, phone: true, dateOfBirth: true },
  });
  if (!isAdult(user.dateOfBirth)) throw new AppError("FORBIDDEN", MINOR_PAYOUT_MESSAGE);
  const data = parseInput(payoutMethodSchema, input);
  // Beneficiary IDs are immutable at Cashfree, so each change registers a new one. Registration
  // needs a mobile number and Cashfree Payouts: without either (Google sign-up, or the live site
  // before Cashfree is connected; DECISIONS M33) the method is saved for prizes paid by hand and
  // registered when the player saves it again later.
  const register = !!user.phone && (!!cashfreePayoutsConfig() || !isProductionDeployment());
  const beneficiaryId = register
    ? `ben_${me.id}_${Date.now().toString(36)}`
    : `${UNREGISTERED_BENEFICIARY}${me.id}_${Date.now().toString(36)}`;
  if (register && user.phone) {
    await getPayoutGateway().addBeneficiary({
      beneficiaryId,
      name: data.accountHolderName,
      phone: user.phone,
      ...(data.kind === "UPI"
        ? { vpa: data.vpa }
        : { bankAccountNumber: data.accountNumber, bankIfsc: data.ifsc }),
    });
  }
  const record = {
    kind: data.kind,
    beneficiaryId,
    accountHolderName: data.accountHolderName,
    vpaMasked: data.kind === "UPI" ? maskVpa(data.vpa) : null,
    accountLast4: data.kind === "BANK" ? data.accountNumber.slice(-4) : null,
    ifsc: data.kind === "BANK" ? data.ifsc : null,
  };
  // The full UPI ID is kept only so its owner can reveal it on their profile (DECISIONS M12).
  const vpa = data.kind === "UPI" ? data.vpa : null;
  return db.$transaction(async (tx) => {
    const before = await tx.payoutMethod.findUnique({ where: { userId: me.id }, omit: { vpa: true } });
    const saved = await tx.payoutMethod.upsert({
      where: { userId: me.id },
      create: { userId: me.id, ...record, vpa },
      update: { ...record, vpa },
      omit: { vpa: true },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payoutMethod.save",
      entityType: "PayoutMethod",
      entityId: saved.id,
      before,
      after: saved,
    });
    return saved;
  });
}

/** A ledger row nobody has acted on yet: it may still be re-pointed, resized or removed. */
export const UNSTARTED_PAYOUT = {
  status: "PENDING",
  approvedById: null,
  transferId: null,
  manualReference: null,
  voidedAt: null,
} satisfies Prisma.PayoutWhereInput;

interface PrizeLine {
  userId: string;
  place: number;
  amountPaise: number;
}

/**
 * Make the un-started ledger rows of one prize source (a tournament or a scrim) equal `lines`:
 * create missing rows, update stale amounts/places, delete rows whose payee is no longer a winner.
 * Rows already approved, sent, paid manually or voided are never touched.
 */
async function syncPrizeLines(
  tx: Tx,
  source: { tournamentId: string } | { matchId: string },
  lines: PrizeLine[],
  actorId: string | null,
) {
  const counts = { created: 0, updated: 0, removed: 0, newWinners: [] as PrizeLine[] };
  const existing = await tx.payout.findMany({ where: source });
  const winners = new Set(lines.map((l) => l.userId));
  const audit = (action: string, entityId: string, before: unknown, after: unknown) =>
    writeAudit(tx, { actorId, action, entityType: "Payout", entityId, before, after });

  for (const row of existing) {
    if (winners.has(row.userId)) continue;
    const { count } = await tx.payout.deleteMany({ where: { id: row.id, ...UNSTARTED_PAYOUT } });
    if (!count) continue;
    await audit("payout.remove", row.id, row, { reason: "No longer a winner" });
    counts.removed++;
  }
  for (const line of lines) {
    const row = existing.find((p) => p.userId === line.userId);
    if (!row) {
      const p = await tx.payout.create({ data: { ...source, ...line } });
      await audit("payout.create", p.id, undefined, p);
      counts.created++;
      // Told after the caller's transaction commits (PRIZE_WON, DECISIONS M28).
      counts.newWinners.push(line);
      continue;
    }
    if (row.amountPaise === line.amountPaise && row.place === line.place) continue;
    const { count } = await tx.payout.updateMany({
      where: { id: row.id, ...UNSTARTED_PAYOUT },
      data: { amountPaise: line.amountPaise, place: line.place },
    });
    if (!count) continue;
    await audit(
      "payout.update",
      row.id,
      { amountPaise: row.amountPaise, place: row.place },
      { amountPaise: line.amountPaise, place: line.place },
    );
    counts.updated++;
  }
  return counts;
}

/**
 * Bring the ledger in line with every published tournament podium: new prizes are added,
 * un-started rows follow later edits (payee, amount, place) and rows for removed winners go away.
 */
export async function syncTournamentPayouts(actor: Actor | null) {
  const me = assertAdmin(actor);
  const withRows = await payoutTournamentIds();
  const tournaments = await db.tournament.findMany({
    // Published podiums, plus unpublished ones that still have ledger rows to clean up.
    where: { OR: [{ winnersPublishedAt: { not: null } }, { id: { in: withRows } }] },
    select: { id: true },
  });
  const total = { created: 0, updated: 0, removed: 0 };
  for (const t of tournaments) {
    const counts = await db.$transaction((tx) => syncTournamentPrizePayouts(tx, t.id, me.id));
    total.created += counts.created;
    total.updated += counts.updated;
    total.removed += counts.removed;
  }
  return total;
}

async function payoutTournamentIds() {
  const rows = await db.payout.findMany({
    where: { tournamentId: { not: null } },
    distinct: ["tournamentId"],
    select: { tournamentId: true },
  });
  return rows.map((r) => r.tournamentId!);
}

/**
 * One tournament's ledger rows follow its published podium (inside the caller's transaction).
 * Unpublished or cleared winners (e.g. results reopened) remove every un-started row;
 * rows already approved, sent, paid by hand or voided stay for an admin to handle.
 */
export async function syncTournamentPrizePayouts(
  tx: Tx,
  tournamentId: string,
  actorId: string | null = null,
) {
  const t = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: { winners: true, winnersPublishedAt: true },
  });
  const lines: PrizeLine[] = [];
  const winners = t?.winnersPublishedAt ? (t.winners as unknown as PublishedWinner[] | null) : null;
  for (const w of winners ?? []) {
    const payee = w.payeeUserId ?? w.userIds[0];
    if (!payee || w.prizePaise <= 0 || lines.some((l) => l.userId === payee)) continue;
    lines.push({ userId: payee, place: w.place, amountPaise: w.prizePaise });
  }
  return syncPrizeLines(tx, { tournamentId }, lines, actorId);
}

/**
 * Scrim prize: one PENDING payout (place 1) for the winner of a non-tournament match with a prize,
 * paid to the registrant (solo player or team captain). Called inside the results approval
 * transaction; re-running it after results change re-points or removes the un-started row.
 */
export async function syncMatchPrizePayout(tx: Tx, matchId: string, actorId: string | null = null) {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      kind: true,
      mode: true,
      prizePaise: true,
      tournamentId: true,
      isEntryList: true,
      status: true,
    },
  });
  if (!match) return { created: 0, updated: 0, removed: 0, newWinners: [] as PrizeLine[] };
  const eligible =
    match.kind === "SCRIM" &&
    !match.tournamentId &&
    !match.isEntryList &&
    match.prizePaise > 0 &&
    match.status === "COMPLETED";
  let winner: string | null = null;
  if (eligible) {
    const results = await tx.result.findMany({
      where: { matchId, registration: { status: "CONFIRMED" } },
      select: { placement: true, won: true, registration: { select: { userId: true } } },
    });
    const top = isHeadToHead(match.mode)
      ? results.filter((r) => r.won === true)
      : results.filter((r) => r.placement === 1);
    winner = top.length === 1 ? top[0]!.registration.userId : null;
  }
  const lines = winner ? [{ userId: winner, place: 1, amountPaise: match.prizePaise }] : [];
  return syncPrizeLines(tx, { matchId }, lines, actorId);
}

const seasonPrizeSchema = z.object({
  seasonId: z.string().min(1),
  place: z.coerce.number().int().min(1).max(3),
  amount: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const p = rupeesToPaise(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "Enter a prize amount" });
      return z.NEVER;
    }
    return p;
  }),
});

/** Season top 3 are verified manually, then the admin adds their prize to the ledger. */
export async function addSeasonPrize(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { seasonId, place, amount } = parseInput(seasonPrizeSchema, input);
  const champion = await db.seasonResult.findUnique({
    where: { seasonId_rank: { seasonId, rank: place } },
  });
  if (!champion)
    throw new AppError("NOT_FOUND", "That season has no archived champion for this place.");
  return db.$transaction(async (tx) => {
    const exists = await tx.payout.findUnique({
      where: { userId_seasonId: { userId: champion.userId, seasonId } },
    });
    if (exists) throw new AppError("CONFLICT", "This player already has a prize for that season.");
    const p = await tx.payout.create({
      data: { userId: champion.userId, seasonId, place, amountPaise: amount },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payout.create",
      entityType: "Payout",
      entityId: p.id,
      after: p,
    });
    return p;
  });
}

export type ApproveOutcome = "AWAITING_SECOND_APPROVAL" | "SENT";

/**
 * Approve a prize. Above the threshold, two different admins must approve; the second approval
 * (or the only one, below the threshold) sends the transfer. FAILED payouts can be approved again.
 */
export async function approvePayout(actor: Actor | null, input: unknown): Promise<ApproveOutcome> {
  const me = assertAdmin(actor);
  const { payoutId } = parseInput(z.object({ payoutId: z.string().min(1) }), input);
  const threshold = payoutTwoStepThresholdPaise();

  const ready = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payout" WHERE "id" = ${payoutId} FOR UPDATE`;
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
      include: { user: { include: { payoutMethod: { omit: { vpa: true } } } } },
    });
    if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
    if (payout.status !== "PENDING" && payout.status !== "FAILED")
      throw new AppError("CONFLICT", "This payout is already in progress or paid.");
    if (payout.voidedAt) throw new AppError("CONFLICT", "This payout was voided.");
    const method = payout.user.payoutMethod;
    if (!method) throw new AppError("CONFLICT", "The winner has not added a payout method yet.");
    if (method.beneficiaryId.startsWith(UNREGISTERED_BENEFICIARY)) {
      throw new AppError(
        "CONFLICT",
        "This UPI ID isn't registered with Cashfree (no mobile number, or Cashfree Payouts wasn't connected when it was saved). Pay this prize by hand (Show UPI), or ask the winner to save their UPI again.",
      );
    }
    if (!isAdult(payout.user.dateOfBirth)) throw new AppError("CONFLICT", MINOR_PAYOUT_MESSAGE);

    const twoStep = needsSecondApproval(payout.amountPaise, threshold);
    const firstApproval = payout.status === "FAILED" || !payout.approvedById;
    if (twoStep && firstApproval) {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: "PENDING",
          approvedById: me.id,
          approvedAt: new Date(),
          secondApprovedById: null,
        },
      });
      await writeAudit(tx, {
        actorId: me.id,
        action: "payout.approve.first",
        entityType: "Payout",
        entityId: payoutId,
        after: { amountPaise: payout.amountPaise },
      });
      return null;
    }
    if (twoStep && payout.approvedById === me.id) {
      throw new AppError(
        "FORBIDDEN",
        "A second, different admin must approve payouts above the limit.",
      );
    }
    const transferId = `tr_${payout.id}_${Date.now().toString(36)}`;
    const updated = await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: "PROCESSING",
        transferId,
        method: method.kind,
        beneficiaryId: method.beneficiaryId,
        failureReason: null,
        ...(twoStep
          ? { secondApprovedById: me.id }
          : { approvedById: me.id, approvedAt: new Date() }),
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payout.approve",
      entityType: "Payout",
      entityId: payoutId,
      before: { status: payout.status },
      after: { status: "PROCESSING", transferId },
    });
    return updated;
  });
  if (!ready) return "AWAITING_SECOND_APPROVAL";

  try {
    const res = await getPayoutGateway().transfer({
      transferId: ready.transferId!,
      amountPaise: ready.amountPaise,
      beneficiaryId: ready.beneficiaryId!,
      mode: ready.method === "UPI" ? "upi" : "banktransfer",
      remarks: `Prize place ${ready.place}`,
    });
    const mapped = mapTransferStatus(res.status);
    await db.payout.update({
      where: { id: ready.id },
      data: {
        cfTransferId: res.cfTransferId,
        rawResponse: res.raw as Prisma.InputJsonValue,
        ...(mapped && canMovePayout("PROCESSING", mapped) ? { status: mapped } : {}),
      },
    });
  } catch (e) {
    const unavailable = e instanceof AppError && e.code === "UNAVAILABLE";
    // 5xx: do not retry blindly — reconciliation checks the transfer later. 4xx: the request was rejected.
    if (!unavailable)
      await db.payout.update({
        where: { id: ready.id },
        data: {
          status: "FAILED",
          failureReason: e instanceof Error ? e.message : "Transfer failed",
        },
      });
    throw e;
  }
  return "SENT";
}

/** Apply a verified TRANSFER_* webhook. Idempotent: payouts only move forward. */
export async function applyTransferEvent(transferId: string, type: string, raw: unknown) {
  const to = mapTransferStatus(type);
  if (!to) return "IGNORED";
  const result = await db.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { transferId } });
    if (!payout) throw new AppError("NOT_FOUND", "Unknown transfer");
    if (!canMovePayout(payout.status, to)) return { outcome: "IGNORED" as const, payout };
    await tx.payout.update({
      where: { id: payout.id },
      data: { status: to, rawResponse: raw as Prisma.InputJsonValue },
    });
    await writeAudit(tx, {
      actorId: null,
      action: `payout.${to.toLowerCase()}`,
      entityType: "Payout",
      entityId: payout.id,
      before: { status: payout.status },
      after: { status: to, transferId },
    });
    return { outcome: to, payout };
  });
  if (result.outcome !== "IGNORED")
    await notify({
      type: "PAYOUT_STATUS",
      userIds: [result.payout.userId],
      payoutId: result.payout.id,
      status: result.outcome,
    });
  return result.outcome;
}

/**
 * Paid by hand, not through a live Cashfree transfer: no transfer was sent, or it went to the local
 * stub gateway (dev/test only; production refuses to start with it). Only these can be moved to
 * "Processing" by an admin (DECISIONS M26); a real transfer's status comes from Cashfree.
 */
export function isManualPayout(p: { transferId: string | null; cfTransferId: string | null }) {
  return !p.transferId || !!p.cfTransferId?.startsWith("stub_");
}

/** Lock a payout that an admin may still settle by hand (waiting, failed or manual processing). */
async function lockOpenPayout(tx: Tx, payoutId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Payout" WHERE "id" = ${payoutId} FOR UPDATE`;
  const payout = await tx.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
  if (payout.voidedAt) throw new AppError("CONFLICT", "This payout was voided.");
  const open =
    payout.status === "PENDING" ||
    payout.status === "FAILED" ||
    (payout.status === "PROCESSING" && isManualPayout(payout));
  if (!open) throw new AppError("CONFLICT", "Only unpaid payouts can be changed by hand.");
  return payout;
}

const progressSchema = z.object({
  payoutId: z.string().min(1),
  status: z.enum(["PENDING", "PROCESSING"]),
});

/**
 * Admin sets where a hand-paid prize stands: "Waiting" (PENDING) or "Processing" (being sent).
 * "Confirmed" is markPayoutPaidManually, which records the UPI/bank reference (DECISIONS M26).
 */
export async function setPayoutProgress(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { payoutId, status } = parseInput(progressSchema, input);
  const payout = await db.$transaction(async (tx) => {
    const before = await lockOpenPayout(tx, payoutId);
    if (before.status === status) return null;
    const after = await tx.payout.update({
      where: { id: payoutId },
      data: { status, failureReason: status === "PROCESSING" ? null : before.failureReason },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payout.manualStatus",
      entityType: "Payout",
      entityId: payoutId,
      before: { status: before.status },
      after: { status },
    });
    return after;
  });
  if (payout?.status === "PROCESSING") {
    await notify({ type: "PAYOUT_STATUS", userIds: [payout.userId], payoutId, status: "PROCESSING" });
  }
  return payout;
}

const manualPaidSchema = z.object({
  payoutId: z.string().min(1),
  reference: z.string().trim().min(4, "Enter the UPI/bank reference").max(100),
});

/** The prize was paid outside Cashfree (UPI/bank by hand): record the reference and mark SUCCESS. */
export async function markPayoutPaidManually(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { payoutId, reference } = parseInput(manualPaidSchema, input);
  const payout = await db.$transaction(async (tx) => {
    const before = await lockOpenPayout(tx, payoutId);
    const after = await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: "SUCCESS",
        manualReference: reference,
        failureReason: null,
        approvedById: before.approvedById ?? me.id,
        approvedAt: before.approvedAt ?? new Date(),
      },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payout.manualPaid",
      entityType: "Payout",
      entityId: payoutId,
      before: { status: before.status },
      after: { status: "SUCCESS", manualReference: reference },
    });
    return after;
  });
  await notify({
    type: "PAYOUT_STATUS",
    userIds: [payout.userId],
    payoutId: payout.id,
    status: "SUCCESS",
  });
  return payout;
}

const voidSchema = z.object({
  payoutId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

/** Void a prize that must not be paid (e.g. disqualified winner). It leaves lists and totals. */
export async function voidPayout(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { payoutId, reason } = parseInput(voidSchema, input);
  return db.$transaction(async (tx) => {
    const before = await lockOpenPayout(tx, payoutId);
    const after = await tx.payout.update({
      where: { id: payoutId },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "payout.void",
      entityType: "Payout",
      entityId: payoutId,
      before: { status: before.status, amountPaise: before.amountPaise },
      after: { voidReason: reason },
    });
    return after;
  });
}

/** Mark a nightly reconciliation difference as handled. */
export async function resolveReconciliationFlag(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { flagId } = parseInput(z.object({ flagId: z.string().min(1) }), input);
  return db.$transaction(async (tx) => {
    const flag = await tx.reconciliationFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new AppError("NOT_FOUND", "Flag not found.");
    if (flag.resolvedAt) throw new AppError("CONFLICT", "This flag is already resolved.");
    const after = await tx.reconciliationFlag.update({
      where: { id: flagId },
      data: { resolvedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "reconciliation.resolve",
      entityType: "ReconciliationFlag",
      entityId: flagId,
      before: flag,
      after: { resolvedAt: after.resolvedAt },
    });
    return after;
  });
}

/** Payouts that count: voided rows are excluded from lists and totals unless asked for. */
export function payoutWhere(includeVoided = false): Prisma.PayoutWhereInput {
  return includeVoided ? {} : { voidedAt: null };
}

/**
 * Admin reveals a winner's full UPI ID to pay the prize by hand (DECISIONS M32). Only for an unpaid,
 * un-voided payout; every reveal is audited (without the UPI ID itself).
 */
export async function revealPayoutUpi(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { payoutId } = parseInput(z.object({ payoutId: z.string().min(1) }), input);
  const payout = await db.payout.findUnique({
    where: { id: payoutId },
    select: {
      status: true,
      voidedAt: true,
      userId: true,
      user: { select: { payoutMethod: { select: { kind: true, vpa: true, accountHolderName: true } } } },
    },
  });
  if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
  if (payout.voidedAt || payout.status === "SUCCESS" || payout.status === "REVERSED") {
    throw new AppError("CONFLICT", "This prize is not waiting to be paid.");
  }
  const method = payout.user.payoutMethod;
  if (method?.kind !== "UPI" || !method.vpa) {
    throw new AppError("NOT_FOUND", "The winner hasn't added a UPI ID yet.");
  }
  await db.$transaction((tx) =>
    writeAudit(tx, {
      actorId: me.id,
      action: "payout.revealUpi",
      entityType: "Payout",
      entityId: payoutId,
      after: { winnerId: payout.userId },
    }),
  );
  return { vpa: method.vpa, name: method.accountHolderName };
}

export async function listPayoutLedger(actor: Actor | null, opts: { includeVoided?: boolean } = {}) {
  assertAdmin(actor);
  return db.payout.findMany({
    where: payoutWhere(opts.includeVoided),
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          dateOfBirth: true,
          payoutMethod: { select: { kind: true, vpaMasked: true, accountLast4: true, ifsc: true } },
        },
      },
    },
  });
}

/** What a payout is for: tournament title, season name or scrim title, keyed by payout id. */
export async function payoutSources(
  payouts: {
    id: string;
    tournamentId: string | null;
    seasonId: string | null;
    matchId: string | null;
  }[],
) {
  const ids = (k: "tournamentId" | "seasonId" | "matchId") => [
    ...new Set(payouts.map((p) => p[k]).filter((v): v is string => !!v)),
  ];
  const [tournaments, seasons, matches] = await Promise.all([
    db.tournament.findMany({
      where: { id: { in: ids("tournamentId") } },
      select: { id: true, title: true },
    }),
    db.season.findMany({
      where: { id: { in: ids("seasonId") } },
      select: { id: true, name: true, game: true },
    }),
    db.match.findMany({
      where: { id: { in: ids("matchId") } },
      select: { id: true, title: true },
    }),
  ]);
  const t = new Map(tournaments.map((x) => [x.id, `Tournament: ${x.title}`]));
  const s = new Map(seasons.map((x) => [x.id, `Season: ${x.name} (${x.game})`]));
  const m = new Map(matches.map((x) => [x.id, `Scrim: ${x.title}`]));
  return new Map(
    payouts.map((p) => [
      p.id,
      (p.tournamentId && t.get(p.tournamentId)) ||
        (p.seasonId && s.get(p.seasonId)) ||
        (p.matchId && m.get(p.matchId)) ||
        "—",
    ]),
  );
}

/** CSV of the whole ledger for accounting (admins only). Only masked payout details are included. */
export async function exportPayoutsCsv(
  actor: Actor | null,
  opts: { includeVoided?: boolean } = {},
): Promise<{ filename: string; csv: string }> {
  assertAdmin(actor);
  const rows = await db.payout.findMany({
    where: payoutWhere(opts.includeVoided),
    orderBy: { createdAt: "asc" },
    include: { user: { select: { displayName: true } } },
  });
  const sources = await payoutSources(rows);
  const header = [
    "payout_id",
    "created_at_ist",
    "player",
    "user_id",
    "for",
    "place",
    "amount_inr",
    "status",
    "method",
    "transfer_id",
    "cf_transfer_id",
    "manual_reference",
    "failure_reason",
    "voided_at_ist",
    "void_reason",
  ];
  const lines = rows.map((p) =>
    [
      p.id,
      formatIST(p.createdAt),
      p.user.displayName ?? "",
      p.userId,
      sources.get(p.id) ?? "",
      p.place,
      (p.amountPaise / 100).toFixed(2),
      p.status,
      p.method,
      p.transferId,
      p.cfTransferId,
      p.manualReference,
      p.failureReason,
      p.voidedAt ? formatIST(p.voidedAt) : null,
      p.voidReason,
    ]
      .map(csvCell)
      .join(","),
  );
  const stamp = utcToIstInput(new Date()).slice(0, 10);
  return {
    filename: `payouts-${stamp}.csv`,
    csv: [header.join(","), ...lines].join("\n") + "\n",
  };
}
