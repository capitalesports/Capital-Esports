import { NextResponse } from "next/server";
import { checkCronAuth } from "@/server/cron";
import { pruneRateLimits } from "@/server/rate-limit";
import { runSeasonRollover } from "@/server/services/seasons";

export const maxDuration = 60;

/** Daily (vercel.json): archive seasons that have ended and start the next ones; housekeeping. */
export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const rolled = await runSeasonRollover();
  const pruned = await pruneRateLimits();
  return NextResponse.json({ ok: true, rolled, pruned });
}
