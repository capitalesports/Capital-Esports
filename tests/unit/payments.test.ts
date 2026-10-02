import { describe, expect, it } from "vitest";
import {
  canMovePayout,
  isAdult,
  isValidIfsc,
  isValidUpi,
  mapTransferStatus,
  maskVpa,
  needsSecondApproval,
  nextPaymentStatus,
  nextRefundStatus,
  paiseToRupees,
  payoutMethodSchema,
} from "@/lib/payments";
import { signWebhook, verifyWebhookSignature } from "@/lib/webhook-signature";

describe("webhook signature", () => {
  const secret = "cf_secret_123";
  const ts = "1617695238078";
  const body = '{"data":{"order":{"order_id":"ord_1"}},"type":"PAYMENT_SUCCESS_WEBHOOK"}';

  it("matches Cashfree's documented algorithm: base64(HMAC-SHA256(ts + body))", async () => {
    const { createHmac } = await import("node:crypto");
    expect(signWebhook(secret, ts, body)).toBe(createHmac("sha256", secret).update(ts + body).digest("base64"));
  });

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(secret, signWebhook(secret, ts, body), ts, body)).toBe(true);
  });

  it("rejects a tampered payload, timestamp or signature", () => {
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhookSignature(secret, sig, ts, body.replace("ord_1", "ord_2"))).toBe(false);
    expect(verifyWebhookSignature(secret, sig, "1617695238079", body)).toBe(false);
    expect(verifyWebhookSignature(secret, sig.slice(0, -2) + "AA", ts, body)).toBe(false);
    expect(verifyWebhookSignature("other", sig, ts, body)).toBe(false);
  });

  it("rejects missing headers or secret", () => {
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhookSignature(secret, null, ts, body)).toBe(false);
    expect(verifyWebhookSignature(secret, sig, null, body)).toBe(false);
    expect(verifyWebhookSignature("", sig, ts, body)).toBe(false);
  });
});

describe("UPI and IFSC validators", () => {
  it.each(["ravi@okaxis", "ravi.kumar-99@ybl", "9876543210@paytm", "a_b@upi"])("accepts UPI %s", (v) => expect(isValidUpi(v)).toBe(true));
  it.each(["ravi", "@okaxis", "ravi@", "ravi@@okaxis", "ra vi@okaxis", "ravi@ok axis", "ravi@1bank"])("rejects UPI %s", (v) =>
    expect(isValidUpi(v)).toBe(false),
  );
  it.each(["HDFC0001234", "SBIN0000001", "icic0abcdef"])("accepts IFSC %s", (v) => expect(isValidIfsc(v)).toBe(true));
  it.each(["HDFC1001234", "HDF0001234", "HDFC00012345", "1234056789A", ""])("rejects IFSC %s", (v) => expect(isValidIfsc(v)).toBe(false));

  it("validates a whole payout method", () => {
    expect(payoutMethodSchema.safeParse({ kind: "UPI", accountHolderName: "Ravi Kumar", vpa: "ravi@okaxis" }).success).toBe(true);
    const bank = payoutMethodSchema.parse({ kind: "BANK", accountHolderName: "Ravi Kumar", accountNumber: "123456789012", ifsc: "hdfc0001234" });
    expect(bank).toMatchObject({ ifsc: "HDFC0001234" });
    expect(payoutMethodSchema.safeParse({ kind: "BANK", accountHolderName: "Ravi", accountNumber: "12ab", ifsc: "HDFC0001234" }).success).toBe(false);
    expect(payoutMethodSchema.safeParse({ kind: "UPI", accountHolderName: "R", vpa: "ravi@okaxis" }).success).toBe(false);
  });

  it("masks UPI IDs", () => {
    expect(maskVpa("ravikumar@okaxis")).toBe("ra*******@okaxis");
    expect(maskVpa("ab@ybl")).toBe("ab**@ybl");
  });
});

describe("payment state", () => {
  it("confirms once and ignores replays", () => {
    expect(nextPaymentStatus("CREATED", "SUCCESS")).toBe("PAID");
    expect(nextPaymentStatus("PAID", "SUCCESS")).toBeNull();
    expect(nextPaymentStatus("FAILED", "SUCCESS")).toBe("PAID");
    expect(nextPaymentStatus("REFUND_PENDING", "SUCCESS")).toBeNull();
    expect(nextPaymentStatus("REFUNDED", "SUCCESS")).toBeNull();
  });

  it("fails only unpaid orders", () => {
    expect(nextPaymentStatus("CREATED", "FAILED")).toBe("FAILED");
    expect(nextPaymentStatus("CREATED", "USER_DROPPED")).toBe("FAILED");
    expect(nextPaymentStatus("PAID", "FAILED")).toBeNull();
    expect(nextPaymentStatus("FAILED", "FAILED")).toBeNull();
  });

  it("refunds move REFUND_PENDING -> REFUNDED only on success", () => {
    expect(nextRefundStatus("REFUND_PENDING", "SUCCESS")).toBe("REFUNDED");
    expect(nextRefundStatus("REFUND_PENDING", "PENDING")).toBeNull();
    expect(nextRefundStatus("REFUND_PENDING", "CANCELLED")).toBeNull();
    expect(nextRefundStatus("REFUNDED", "SUCCESS")).toBeNull();
    expect(nextRefundStatus("PAID", "SUCCESS")).toBeNull();
  });

  it("converts paise to rupees for the API", () => {
    expect(paiseToRupees(4950)).toBe(49.5);
    expect(paiseToRupees(100)).toBe(1);
  });
});

describe("payout state", () => {
  it("maps Cashfree statuses and events", () => {
    expect(mapTransferStatus("TRANSFER_SUCCESS")).toBe("SUCCESS");
    expect(mapTransferStatus("TRANSFER_REJECTED")).toBe("FAILED");
    expect(mapTransferStatus("TRANSFER_REVERSED")).toBe("REVERSED");
    expect(mapTransferStatus("TRANSFER_ACKNOWLEDGED")).toBe("PROCESSING");
    expect(mapTransferStatus("RECEIVED")).toBe("PROCESSING");
    expect(mapTransferStatus("LOW_BALANCE_ALERT")).toBeNull();
  });

  it("only moves forward (no double pay)", () => {
    expect(canMovePayout("PROCESSING", "SUCCESS")).toBe(true);
    expect(canMovePayout("SUCCESS", "SUCCESS")).toBe(false);
    expect(canMovePayout("SUCCESS", "FAILED")).toBe(false);
    expect(canMovePayout("SUCCESS", "PROCESSING")).toBe(false);
    expect(canMovePayout("SUCCESS", "REVERSED")).toBe(true);
    expect(canMovePayout("FAILED", "SUCCESS")).toBe(false);
    expect(canMovePayout("PENDING", "REVERSED")).toBe(false);
  });

  it("needs a second approval above the threshold", () => {
    expect(needsSecondApproval(500_000, 500_000)).toBe(false);
    expect(needsSecondApproval(500_001, 500_000)).toBe(true);
  });

  it("blocks minors from payouts", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    expect(isAdult(new Date("2008-09-27T00:00:00Z"), now)).toBe(true);
    expect(isAdult(new Date("2008-09-28T00:00:00Z"), now)).toBe(false);
    expect(isAdult(null, now)).toBe(false);
  });
});
