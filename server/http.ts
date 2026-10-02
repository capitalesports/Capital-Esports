import "server-only";
import { NextResponse } from "next/server";
import { AppError, isAppError } from "./errors";

/** Best-effort client IP (Vercel sets x-forwarded-for; first entry is the client). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * CSRF defence for route handlers that mutate state with cookies:
 * the Origin (or Referer) must match the request host.
 */
export function assertSameOrigin(request: Request): void {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!host || !origin) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

/** Convert a thrown error into a JSON response; unexpected errors become a generic 500. */
export function errorResponse(e: unknown): NextResponse {
  if (isAppError(e)) {
    return NextResponse.json(
      { ok: false, code: e.code, error: e.message, fieldErrors: e.fieldErrors },
      { status: e.status },
    );
  }
  console.error(e);
  return NextResponse.json(
    { ok: false, code: "INTERNAL", error: "Something went wrong." },
    { status: 500 },
  );
}
