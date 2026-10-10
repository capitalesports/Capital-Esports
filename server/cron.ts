import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Returns a 401 response when invalid. */
export function checkCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Hash both sides: equal-length digests, so odd (non-ASCII) headers can't throw.
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const ok = !!secret && timingSafeEqual(digest(header), digest(expected));
  return ok ? null : NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
