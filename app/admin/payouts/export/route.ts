import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/guards";
import { errorResponse } from "@/server/http";
import { exportPayoutsCsv } from "@/server/services/payouts";

/** CSV download of the payout ledger (admins only). `?voided=1` includes voided rows. */
export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const includeVoided = new URL(request.url).searchParams.get("voided") === "1";
    const { filename, csv } = await exportPayoutsCsv(actor, { includeVoided });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
