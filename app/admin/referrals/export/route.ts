import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/guards";
import { errorResponse } from "@/server/http";
import { referralsCsv } from "@/server/services/referrals";

/** CSV download of the referrals report (admins only). */
export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const period = new URL(request.url).searchParams.get("period") ?? "all";
    const { filename, csv } = await referralsCsv(actor, { period });
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
