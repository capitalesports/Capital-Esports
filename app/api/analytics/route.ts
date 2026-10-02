import { NextResponse } from "next/server";
import { clientIp } from "@/server/http";
import { consumeRateLimit } from "@/server/rate-limit";
import { normalisePath, recordPageView } from "@/server/services/analytics";

/**
 * First-party page-view beacon. Stores only the path and time: no IP, no user, no cookies.
 * The IP is used transiently for a rate limit key only.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = normalisePath(body?.path);
  if (!path) return new NextResponse(null, { status: 204 });
  const { allowed } = await consumeRateLimit(`pv:${clientIp(request.headers)}`, 120, 60);
  if (allowed) await recordPageView(path);
  return new NextResponse(null, { status: 204 });
}
