import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cashfree webhook signature (PG and Payouts v2):
 * base64( HMAC-SHA256( secret, timestamp + rawBody ) ), sent in `x-webhook-signature`
 * with the timestamp in `x-webhook-timestamp`. Always verify against the raw body text.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
}

export function verifyWebhookSignature(
  secret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!secret || !signature || !timestamp) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
