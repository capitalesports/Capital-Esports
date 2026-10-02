import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-token";
import { assertSameOrigin, errorResponse } from "@/server/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
