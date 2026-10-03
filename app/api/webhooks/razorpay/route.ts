import { NextResponse } from "next/server";
import { handleRazorpayWebhook } from "@/server/services/webhooks";

/** Razorpay webhooks (payments + refunds). Raw body is required for the signature. */
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const r = await handleRazorpayWebhook(
      raw,
      request.headers.get("x-razorpay-signature"),
      request.headers.get("x-razorpay-event-id"),
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("Razorpay webhook processing failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
