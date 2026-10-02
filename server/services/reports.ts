import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { isWithinDisputeWindow } from "@/lib/points";
import { assertModerator, assertUser, type Actor } from "@/lib/roles";
import { notify } from "./notify";

export const REPORT_LIMIT = { limit: 5, windowSeconds: 3600 };

const createSchema = z
  .object({
    type: z.enum(["PLAYER", "RESULT", "DISPUTE"]),
    targetUserId: z.string().min(1).optional(),
    matchId: z.string().min(1).optional(),
    reason: z.string().trim().min(10, "Describe what happened (10+ characters)").max(1000),
    evidenceUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || /^https:\/\//.test(v), "Evidence link must start with https://"),
  })
  .refine(
    (v) => (v.type === "PLAYER" ? !!v.targetUserId : !!v.matchId),
    "Say who or which match you are reporting",
  );

/** Report a player or a result, or open a dispute (within 2 hours of approval, players of that match only). */
export async function createReport(actor: Actor | null, input: unknown, now = new Date()) {
  const me = assertUser(actor);
  const data = parseInput(createSchema, input);
  await enforceRateLimit(
    `report:${me.id}`,
    REPORT_LIMIT.limit,
    REPORT_LIMIT.windowSeconds,
    "You have sent several reports. Please wait an hour.",
  );
  if (data.targetUserId === me.id) throw new AppError("VALIDATION", "You cannot report yourself.");
  if (
    data.targetUserId &&
    !(await db.user.findUnique({ where: { id: data.targetUserId }, select: { id: true } }))
  ) {
    throw new AppError("NOT_FOUND", "Player not found.");
  }
  if (data.matchId) {
    const match = await db.match.findUnique({
      where: { id: data.matchId },
      select: { status: true, resultsApprovedAt: true },
    });
    if (!match) throw new AppError("NOT_FOUND", "Match not found.");
    if (data.type === "DISPUTE") {
      if (match.status !== "COMPLETED" || !isWithinDisputeWindow(match.resultsApprovedAt, now)) {
        throw new AppError(
          "CONFLICT",
          "Disputes can only be opened within 2 hours of results being posted.",
        );
      }
      const played = await db.registration.findFirst({
        where: {
          matchId: data.matchId,
          OR: [{ userId: me.id }, { members: { some: { userId: me.id } } }],
        },
        select: { id: true },
      });
      if (!played)
        throw new AppError("FORBIDDEN", "Only players in this match can dispute its results.");
    }
  }
  const report = await db.report.create({ data: { ...data, reporterId: me.id } });
  if (data.type === "DISPUTE") {
    const staff = await db.user.findMany({
      where: { role: { in: ["MODERATOR", "ADMIN"] } },
      select: { id: true },
    });
    await notify({
      type: "DISPUTE_OPENED",
      userIds: staff.map((s) => s.id),
      matchId: data.matchId ?? null,
    });
  }
  return report;
}

export async function listReports(
  actor: Actor | null,
  status: "OPEN" | "RESOLVED" | "DISMISSED" = "OPEN",
) {
  assertModerator(actor);
  return db.report.findMany({
    where: { status },
    orderBy: { createdAt: status === "OPEN" ? "asc" : "desc" },
    take: 100,
    include: {
      reporter: { select: { id: true, displayName: true } },
      targetUser: { select: { id: true, displayName: true } },
      match: { select: { id: true, title: true, status: true, resultsApprovedAt: true } },
    },
  });
}

const resolveSchema = z.object({
  reportId: z.string().min(1),
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolution: z.string().trim().min(3, "Write a short resolution").max(1000),
});

export async function resolveReport(actor: Actor | null, input: unknown) {
  const me = assertModerator(actor);
  const { reportId, status, resolution } = parseInput(resolveSchema, input);
  const report = await db.$transaction(async (tx) => {
    const before = await tx.report.findUnique({ where: { id: reportId } });
    if (!before) throw new AppError("NOT_FOUND", "Report not found.");
    if (before.status !== "OPEN") throw new AppError("CONFLICT", "This report is already closed.");
    const after = await tx.report.update({
      where: { id: reportId },
      data: { status, resolution, resolvedById: me.id, resolvedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "report.resolve",
      entityType: "Report",
      entityId: reportId,
      before,
      after,
    });
    return after;
  });
  if (report.type === "DISPUTE") {
    await notify({
      type: "DISPUTE_RESOLVED",
      userIds: [report.reporterId],
      matchId: report.matchId,
      outcome: status,
    });
  }
  return report;
}
