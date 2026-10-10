import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertAdmin, type Actor } from "@/lib/roles";
import { istInputToUtc } from "@/lib/time";

export interface AuditFilters {
  actor?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  /** IST dates "YYYY-MM-DD" */
  from?: string;
  to?: string;
  page?: number;
}

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditLogs(actor: Actor | null, f: AuditFilters) {
  assertAdmin(actor);
  const where: Prisma.AuditLogWhereInput = {};
  if (f.entityType) where.entityType = f.entityType;
  if (f.entityId) where.entityId = f.entityId;
  if (f.action) where.action = { startsWith: f.action };
  if (f.actor === "system") where.actorId = null;
  else if (f.actor) {
    where.actor = {
      OR: [
        { displayName: { contains: f.actor, mode: "insensitive" } },
        { email: { contains: f.actor, mode: "insensitive" } },
        { phone: { contains: f.actor.replace(/\D/g, "") || f.actor } },
      ],
    };
  }
  const from = f.from ? istInputToUtc(`${f.from}T00:00`) : null;
  const to = f.to ? istInputToUtc(`${f.to}T23:59`) : null;
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

  const page = Math.min(10_000, Math.max(1, Math.trunc(f.page ?? 1) || 1));
  const [rows, total, entityTypes] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { actor: { select: { id: true, displayName: true, role: true } } },
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
  ]);
  return {
    rows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    entityTypes: entityTypes.map((e) => e.entityType),
  };
}
