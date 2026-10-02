/** Pure rules for entry-fee payments and prize payouts. Amounts are integer paise. */
import { z } from "zod";
import { ageOn } from "./validators";

export const PAYMENT_WINDOW_MINUTES = 10;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** UPI VPA: handle@provider, e.g. ravi.k-99@okaxis */
export const UPI_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
/** IFSC: 4 letters, a zero, then 6 letters/digits, e.g. HDFC0001234 */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers are 9–18 digits. */
export const BANK_ACCOUNT_REGEX = /^\d{9,18}$/;

export function isValidUpi(v: string): boolean {
  return UPI_REGEX.test(v.trim());
}

export function isValidIfsc(v: string): boolean {
  return IFSC_REGEX.test(v.trim().toUpperCase());
}

const holderName = z
  .string()
  .trim()
  .min(3, "Enter the account holder's name")
  .max(80)
  .regex(/^[\p{L} .'-]+$/u, "Letters, spaces and . ' - only");

export const payoutMethodSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("UPI"),
    accountHolderName: holderName,
    vpa: z.string().trim().refine(isValidUpi, "Enter a valid UPI ID, e.g. name@okaxis"),
  }),
  z.object({
    kind: z.literal("BANK"),
    accountHolderName: holderName,
    accountNumber: z.string().trim().regex(BANK_ACCOUNT_REGEX, "Account number is 9–18 digits"),
    ifsc: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => IFSC_REGEX.test(v), "Enter a valid IFSC, e.g. HDFC0001234"),
  }),
]);
export type PayoutMethodInput = z.infer<typeof payoutMethodSchema>;

/** "ravikumar@okaxis" -> "ra******@okaxis" */
export function maskVpa(vpa: string): string {
  const [name = "", host = ""] = vpa.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}@${host}`;
}

export const ADULT_AGE = 18;

/** Prize payouts to minors need a guardian account (DECISIONS D6.x). */
export function isAdult(dateOfBirth: Date | null, now = new Date()): boolean {
  return !!dateOfBirth && ageOn(dateOfBirth, now) >= ADULT_AGE;
}

// ---------------------------------------------------------------------------
// Payment state
// ---------------------------------------------------------------------------

export type PaymentStatus = "CREATED" | "PAID" | "FAILED" | "REFUND_PENDING" | "REFUNDED";
export type PaymentEvent = "SUCCESS" | "FAILED" | "USER_DROPPED";

/**
 * Next payment status for a webhook event, or null when the event must be ignored
 * (already processed, or would move the payment backwards).
 */
export function nextPaymentStatus(
  current: PaymentStatus,
  event: PaymentEvent,
): PaymentStatus | null {
  if (event === "SUCCESS") return current === "CREATED" || current === "FAILED" ? "PAID" : null;
  return current === "CREATED" ? "FAILED" : null;
}

export type RefundEvent = "SUCCESS" | "CANCELLED" | "PENDING" | "ONHOLD";

export function nextRefundStatus(current: PaymentStatus, event: RefundEvent): PaymentStatus | null {
  if (current !== "REFUND_PENDING") return null;
  return event === "SUCCESS" ? "REFUNDED" : null;
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

// ---------------------------------------------------------------------------
// Payout state
// ---------------------------------------------------------------------------

export type PayoutStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REVERSED";

/** Map a Cashfree Payouts v2 status / event to ours. */
export function mapTransferStatus(cf: string): PayoutStatus | null {
  switch (cf.toUpperCase()) {
    case "TRANSFER_SUCCESS":
    case "SUCCESS":
      return "SUCCESS";
    case "TRANSFER_FAILED":
    case "TRANSFER_REJECTED":
    case "FAILED":
    case "REJECTED":
      return "FAILED";
    case "TRANSFER_REVERSED":
    case "REVERSED":
      return "REVERSED";
    case "TRANSFER_ACKNOWLEDGED":
    case "RECEIVED":
    case "QUEUED":
    case "PENDING":
    case "APPROVAL_PENDING":
    case "VALIDATION_PENDING":
      return "PROCESSING";
    default:
      return null;
  }
}

const PAYOUT_RANK: Record<PayoutStatus, number> = {
  PENDING: 0,
  PROCESSING: 1,
  FAILED: 2,
  SUCCESS: 2,
  REVERSED: 3,
};

/** Payouts only move forward; a success can later be reversed by the bank. */
export function canMovePayout(from: PayoutStatus, to: PayoutStatus): boolean {
  if (from === to) return false;
  if (to === "REVERSED") return from === "SUCCESS" || from === "PROCESSING";
  return PAYOUT_RANK[to] > PAYOUT_RANK[from];
}

/** Payouts above the threshold need a second, different admin. */
export function needsSecondApproval(amountPaise: number, thresholdPaise: number): boolean {
  return amountPaise > thresholdPaise;
}
