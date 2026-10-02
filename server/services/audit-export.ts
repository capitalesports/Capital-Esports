import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertAdmin, type Actor } from "@/lib/roles";
import { formatIST, istInputToUtc, utcToIstInput } from "@/lib/time";
import type { AuditFilters } from "./audit-log";
import { csvCell } from "./seasons";

/** Rows per export: enough for months of activity, small enough for one response. */
export const AUDIT_EXPORT_LIMIT = 10_000;

/** The same filter as the audit log page (listAuditLogs), without paging. */
export function auditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
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
  return where;
}

/** CSV of the audit entries matching the current filter (admins only), newest first. */
export async function exportAuditCsv(
  actor: Actor | null,
  f: AuditFilters,
): Promise<{ filename: string; csv: string; truncated: boolean }> {
  assertAdmin(actor);
  const rows = await db.auditLog.findMany({
    where: auditWhere(f),
    orderBy: { createdAt: "desc" },
    take: AUDIT_EXPORT_LIMIT + 1,
    include: { actor: { select: { displayName: true, role: true } } },
  });
  const truncated = rows.length > AUDIT_EXPORT_LIMIT;
  const header = [
    "created_at_ist",
    "actor",
    "actor_role",
    "actor_id",
    "action",
    "entity_type",
    "entity_id",
    "before",
    "after",
  ];
  const lines = rows.slice(0, AUDIT_EXPORT_LIMIT).map((r) =>
    [
      formatIST(r.createdAt),
      r.actorId ? (r.actor?.displayName ?? "") : "system",
      r.actor?.role ?? "",
      r.actorId,
      r.action,
      r.entityType,
      r.entityId,
      r.before === null ? null : JSON.stringify(r.before),
      r.after === null ? null : JSON.stringify(r.after),
    ]
      .map(csvCell)
      .join(","),
  );
  return {
    filename: `audit-log-${utcToIstInput(new Date()).slice(0, 10)}.csv`,
    csv: [header.join(","), ...lines].join("\n") + "\n",
    truncated,
  };
}
