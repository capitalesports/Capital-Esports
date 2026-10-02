import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/guards";
import { errorResponse } from "@/server/http";
import { exportAuditCsv } from "@/server/services/audit-export";

/** CSV download of the audit log for the filter in the query string (admins only). */
export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const sp = new URL(request.url).searchParams;
    const str = (k: string) => sp.get(k)?.trim() || undefined;
    const { filename, csv, truncated } = await exportAuditCsv(actor, {
      actor: str("actor"),
      entityType: str("entityType"),
      entityId: str("entityId"),
      action: str("action"),
      from: str("from"),
      to: str("to"),
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        ...(truncated ? { "X-Export-Truncated": "true" } : {}),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
