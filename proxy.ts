import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRollSession,
  signSession,
  verifySession,
} from "@/lib/session-token";
import { gameFromSlug } from "@/lib/games";
import { isHiddenAdminPath, isProtectedPath } from "@/lib/protected-paths";
import { buildCsp } from "@/lib/security-headers";

/** /games/<slug>, /leaderboard/<slug>, /tournament/<slug> */
const GAME_ROUTE = /^\/(?:games|leaderboard|tournament)\/([^/]+)/;

/**
 * Optimistic auth check (JWT only, no DB): logged-out visitors to protected pages go to /login,
 * except the admin panel, which answers 404.
 * Real authorisation happens server-side in pages, actions and route handlers.
 * Also re-issues the session cookie once a day so active users stay logged in (rolling 7 days).
 */
export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? "";
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = secret.length >= 32 ? await verifySession(token, secret) : null;
  const { pathname, search } = request.nextUrl;

  // Unknown game slugs get a real 404 before any page streams (pages stream skeletons first).
  const slug = GAME_ROUTE.exec(pathname)?.[1];
  if (slug && !gameFromSlug(slug)) {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  // Logged-out visitors never learn the admin panel exists: a plain 404, no login redirect (M40).
  if (!claims && isHiddenAdminPath(pathname)) {
    const res = NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!claims && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?returnTo=${encodeURIComponent(pathname + search)}`;
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Pass the path to server layouts (the admin layout checks section access before streaming),
  // and a fresh CSP nonce: Next.js applies it to its own scripts when it sees the CSP request header.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (claims && shouldRollSession(claims)) {
    const secure =
      (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://") ||
      process.env.VERCEL_ENV === "production";
    res.cookies.set(
      SESSION_COOKIE,
      await signSession(claims.userId, secret),
      sessionCookieOptions(secure),
    );
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|.*\.(?:png|jpg|jpeg|svg|webp|gif|ico|txt|xml)$).*)",
  ],
};
