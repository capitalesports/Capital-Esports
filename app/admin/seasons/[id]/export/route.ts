import { NextResponse } from "next/server";
import { getCurrentUser, toActor } from "@/server/auth/session";
import { errorResponse } from "@/server/http";
import { exportSeasonCsv } from "@/server/services/seasons";

/** CSV download of a season's standings (admins only). */
export async function GET(_request: Request, ctx: RouteContext<"/admin/seasons/[id]/export">) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const { filename, csv } = await exportSeasonCsv(user ? toActor(user) : null, id);
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
