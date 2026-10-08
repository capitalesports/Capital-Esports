import { NextResponse } from "next/server";
import { claimReferralFromCookie } from "@/server/auth/referral-cookie";
import { issueSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { trackOnce } from "@/server/services/analytics";
import { limitSessionByIp } from "@/server/services/auth";
import { confirmPasswordSignup } from "@/server/services/password-signup";

/** Finish an email + password sign-up with the emailed code and log in. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limitSessionByIp(clientIp(request.headers));
    const user = await confirmPasswordSignup(await request.json().catch(() => null));
    const cookie = await issueSessionCookie(user.id);
    await trackOnce("LOGIN", user.id);
    const res = NextResponse.json({ ok: true, isNew: true, needsProfile: !user.profileComplete });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    await claimReferralFromCookie(user.id, res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
