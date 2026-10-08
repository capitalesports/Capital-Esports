import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { claimReferral } from "@/server/services/referrals";
import { REFERRAL_COOKIE } from "@/lib/referral";

/**
 * Right after an account is created: credit it to the code in the referral cookie (from /r/CODE or
 * typed on the sign-up page), then drop the cookie. A referral problem never blocks the login.
 */
export async function claimReferralFromCookie(userId: string, res: NextResponse) {
  try {
    const code = (await cookies()).get(REFERRAL_COOKIE)?.value;
    if (!code) return;
    await claimReferral(userId, code);
    res.cookies.delete(REFERRAL_COOKIE);
  } catch (e) {
    console.error("referral claim failed", e);
  }
}
