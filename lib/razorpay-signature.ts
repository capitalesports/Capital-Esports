import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signatures (hex HMAC-SHA256):
 * - Checkout: HMAC(keySecret, "<razorpay_order_id>|<razorpay_payment_id>") = razorpay_signature.
 * - Webhooks: HMAC(webhookSecret, rawBody) = X-Razorpay-Signature header.
 */
function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function sameHex(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function razorpayCheckoutSignature(keySecret: string, orderId: string, paymentId: string) {
  return hmacHex(keySecret, `${orderId}|${paymentId}`);
}

export function verifyRazorpayCheckoutSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string | null | undefined,
): boolean {
  if (!keySecret || !orderId || !paymentId) return false;
  return sameHex(razorpayCheckoutSignature(keySecret, orderId, paymentId), signature);
}

export function razorpayWebhookSignature(webhookSecret: string, rawBody: string) {
  return hmacHex(webhookSecret, rawBody);
}

export function verifyRazorpayWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string | null | undefined,
): boolean {
  if (!webhookSecret) return false;
  return sameHex(razorpayWebhookSignature(webhookSecret, rawBody), signature);
}
