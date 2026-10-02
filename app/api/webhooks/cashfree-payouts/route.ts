import { NextResponse } from "next/server";
import { handlePayoutWebhook } from "@/server/services/webhooks";

/** Cashfree Payouts v2 webhooks (TRANSFER_* events). */
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const r = await handlePayoutWebhook(
      raw,
      request.headers.get("x-webhook-signature"),
      request.headers.get("x-webhook-timestamp"),
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("Payout webhook processing failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
