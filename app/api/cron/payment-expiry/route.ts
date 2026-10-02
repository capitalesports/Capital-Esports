import { NextResponse } from "next/server";
import { checkCronAuth } from "@/server/cron";
import { runPaymentExpiryJob } from "@/server/jobs/payment-jobs";

export const maxDuration = 60;

/** Every 10 minutes (vercel.json): free slots held by unpaid registrations. */
export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true, ...(await runPaymentExpiryJob()) });
}
