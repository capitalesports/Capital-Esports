import { NextResponse } from "next/server";
import { issueSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { trackOnce } from "@/server/services/analytics";
import { limitSessionByIp } from "@/server/services/auth";
import { loginWithEmailCode } from "@/server/services/email";

/** Exchange an emailed login code for our session cookie. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limitSessionByIp(clientIp(request.headers));
    const user = await loginWithEmailCode(await request.json().catch(() => null));
    const cookie = await issueSessionCookie(user.id);
    await trackOnce("LOGIN", user.id);
    const res = NextResponse.json({ ok: true, isNew: false, needsProfile: !user.profileComplete });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
