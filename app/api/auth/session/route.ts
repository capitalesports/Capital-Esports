import { NextResponse } from "next/server";
import { z } from "zod";
import { getOtpVerifier } from "@/server/auth/otp-verifier";
import { claimReferralFromCookie } from "@/server/auth/referral-cookie";
import { issueSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { trackOnce } from "@/server/services/analytics";
import { limitSessionByIp, loginWithVerifiedPhone } from "@/server/services/auth";
import { parseInput } from "@/server/validation";

const bodySchema = z.object({ idToken: z.string().min(10).max(5000) });

/** Exchange a verified Firebase ID token for our own session cookie. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limitSessionByIp(clientIp(request.headers));
    const { idToken } = parseInput(bodySchema, await request.json().catch(() => null));
    const { phone } = await getOtpVerifier().verify(idToken);
    const user = await loginWithVerifiedPhone(phone);
    const cookie = await issueSessionCookie(user.id);
    await trackOnce("LOGIN", user.id);
    if (user.profileComplete) await trackOnce("PROFILE_COMPLETE", user.id);
    const res = NextResponse.json({
      ok: true,
      isNew: user.isNew,
      needsProfile: !user.profileComplete,
    });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    if (user.isNew) await claimReferralFromCookie(user.id, res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
