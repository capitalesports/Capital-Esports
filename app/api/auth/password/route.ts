import { NextResponse } from "next/server";
import { issueSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { trackOnce } from "@/server/services/analytics";
import { limitSessionByIp } from "@/server/services/auth";
import { loginWithPassword } from "@/server/services/password-login";

/** Staff: exchange email + password for our session cookie (DECISIONS M18). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ip = clientIp(request.headers);
    await limitSessionByIp(ip);
    const user = await loginWithPassword(await request.json().catch(() => null), ip);
    const cookie = await issueSessionCookie(user.id);
    await trackOnce("LOGIN", user.id);
    const res = NextResponse.json({ ok: true, isNew: false, needsProfile: !user.profileComplete });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
