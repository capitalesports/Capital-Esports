import { describe, expect, it } from "vitest";
import {
  razorpayCheckoutSignature,
  razorpayWebhookSignature,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "@/lib/razorpay-signature";

describe("Razorpay signatures", () => {
  it("checkout: HMAC of order|payment with the key secret", () => {
    const sig = razorpayCheckoutSignature("secret", "order_1", "pay_1");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyRazorpayCheckoutSignature("secret", "order_1", "pay_1", sig)).toBe(true);
    expect(verifyRazorpayCheckoutSignature("other", "order_1", "pay_1", sig)).toBe(false);
    expect(verifyRazorpayCheckoutSignature("secret", "order_2", "pay_1", sig)).toBe(false);
    expect(verifyRazorpayCheckoutSignature("secret", "order_1", "pay_2", sig)).toBe(false);
    expect(verifyRazorpayCheckoutSignature("secret", "order_1", "pay_1", "")).toBe(false);
    expect(verifyRazorpayCheckoutSignature("", "order_1", "pay_1", sig)).toBe(false);
  });

  it("webhook: HMAC of the raw body with the webhook secret", () => {
    const body = '{"event":"order.paid"}';
    const sig = razorpayWebhookSignature("whsec", body);
    expect(verifyRazorpayWebhookSignature("whsec", body, sig)).toBe(true);
    expect(verifyRazorpayWebhookSignature("whsec", `${body} `, sig)).toBe(false);
    expect(verifyRazorpayWebhookSignature("", body, sig)).toBe(false);
    expect(verifyRazorpayWebhookSignature("whsec", body, null)).toBe(false);
  });
});
