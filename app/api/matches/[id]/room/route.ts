import { NextResponse } from "next/server";
import { getCurrentUser, toActor } from "@/server/auth/session";
import { errorResponse } from "@/server/http";
import { getRoomCredentials } from "@/server/services/room";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** Room ID + password for a confirmed player inside the reveal window. Never cached. */
export async function GET(_request: Request, ctx: RouteContext<"/api/matches/[id]/room">) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const result = await getRoomCredentials(user ? toActor(user) : null, id);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    const res = errorResponse(e);
    res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return res;
  }
}
