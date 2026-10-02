import { NextResponse } from "next/server";
import { handlePgWebhook } from "@/server/services/webhooks";

/** Cashfree PG webhooks (payments + refunds). Raw body is required for the signature. */
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const r = await handlePgWebhook(
      raw,
      request.headers.get("x-webhook-signature"),
      request.headers.get("x-webhook-timestamp"),
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("PG webhook processing failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
