import { NextResponse } from "next/server";
import { checkCronAuth } from "@/server/cron";
import { runReconciliationJob } from "@/server/jobs/payment-jobs";

export const maxDuration = 300;

/** Nightly (vercel.json): compare payments, refunds and transfers with Cashfree. */
export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true, ...(await runReconciliationJob()) });
}
