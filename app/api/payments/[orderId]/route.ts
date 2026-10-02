import { NextResponse } from "next/server";
import { getCurrentUser, toActor } from "@/server/auth/session";
import { errorResponse } from "@/server/http";
import { getMyOrderStatus } from "@/server/services/payments";

export const dynamic = "force-dynamic";

/** Polled by /payments/return: our own record of the order (never the redirect's claim). */
export async function GET(_request: Request, ctx: RouteContext<"/api/payments/[orderId]">) {
  try {
    const user = await getCurrentUser();
    const status = await getMyOrderStatus(user ? toActor(user) : null, (await ctx.params).orderId);
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
