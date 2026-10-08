import { NextResponse } from "next/server";
import { normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "@/lib/referral";
import { siteUrl } from "@/lib/site";

/**
 * Referral link (DECISIONS M52): remember the code for 30 days and open sign-up with it filled in.
 * The code is credited only when a new account is created (see server/auth/referral-cookie.ts).
 */
export async function GET(_request: Request, ctx: RouteContext<"/r/[code]">) {
  const code = normalizeReferralCode((await ctx.params).code);
  const target = new URL(code ? `/signup?ref=${code}` : "/signup", siteUrl());
  const res = NextResponse.redirect(target);
  if (code) {
    res.cookies.set(REFERRAL_COOKIE, code, {
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 86_400,
      sameSite: "lax",
      secure: siteUrl().startsWith("https://"),
      // The sign-up form shows (and can change) the code, so it is readable by the page.
      httpOnly: false,
    });
  }
  return res;
}
