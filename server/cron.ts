import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Returns a 401 response when invalid. */
export function checkCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok =
    !!secret &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  return ok ? null : NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
