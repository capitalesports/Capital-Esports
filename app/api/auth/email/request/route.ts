import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { requestEmailLogin } from "@/server/services/email";

/** Email a login code to a verified email (same answer whether or not the email has an account). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json().catch(() => null);
    const { email } = await requestEmailLogin(body, clientIp(request.headers));
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return errorResponse(e);
  }
}
