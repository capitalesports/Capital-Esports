import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { startPasswordSignup } from "@/server/services/password-signup";

/** Sign up with username, email, date of birth and password: emails a code (DECISIONS M38). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json().catch(() => null);
    const { email } = await startPasswordSignup(body, clientIp(request.headers));
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return errorResponse(e);
  }
}
