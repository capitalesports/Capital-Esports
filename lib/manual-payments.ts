/**
 * Manual UPI payments (DECISIONS M54), pure and safe for client components: the apps a player can
 * say they paid with, the time to upload proof, and transaction-ID clean-up.
 */

export const UPI_APPS = [
  "GOOGLE_PAY",
  "PHONEPE",
  "PAYTM",
  "BHIM",
  "AMAZON_PAY",
  "CRED",
  "OTHER",
] as const;
export type UpiAppId = (typeof UPI_APPS)[number];

export const UPI_APP_LABEL: Record<UpiAppId, string> = {
  GOOGLE_PAY: "Google Pay",
  PHONEPE: "PhonePe",
  PAYTM: "Paytm",
  BHIM: "BHIM UPI",
  AMAZON_PAY: "Amazon Pay",
  CRED: "CRED",
  OTHER: "Other UPI app",
};

/** Minutes a player has to pay the QR and upload proof before the slot is released. */
export const MANUAL_PAYMENT_PROOF_MINUTES = 30;

/** " 4123 5678 9012 " → "412356789012"; null unless 6–35 letters/digits (UTR or app transaction ID). */
export function normalizeTransactionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{6,35}$/.test(id) ? id : null;
}
