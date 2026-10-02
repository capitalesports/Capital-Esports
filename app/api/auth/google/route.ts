import { NextResponse } from "next/server";
import { z } from "zod";
import { getGoogleVerifier } from "@/server/auth/google-verifier";
import { issueSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, clientIp, errorResponse } from "@/server/http";
import { trackOnce } from "@/server/services/analytics";
import { limitSessionByIp } from "@/server/services/auth";
import { loginWithGoogle } from "@/server/services/google-auth";
import { parseInput } from "@/server/validation";

const bodySchema = z.object({ idToken: z.string().min(10).max(5000) });

/**
 * "Continue with Google" (DECISIONS M29, M31): a verified Google ID token for our session cookie.
 * New players get an account straight away (no phone needed).
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limitSessionByIp(clientIp(request.headers));
    const { idToken } = parseInput(bodySchema, await request.json().catch(() => null));
    const profile = await getGoogleVerifier().verify(idToken);
    const user = await loginWithGoogle(profile);
    const cookie = await issueSessionCookie(user.id);
    await trackOnce("LOGIN", user.id);
    if (user.profileComplete) await trackOnce("PROFILE_COMPLETE", user.id);
    const res = NextResponse.json({ ok: true, isNew: user.isNew, needsProfile: !user.profileComplete });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
