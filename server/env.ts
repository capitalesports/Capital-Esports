import "server-only";

/** Server-only configuration. Reads process.env lazily so tests can override values. */

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return secret;
}

/** True on the Vercel production deployment (stubs are never allowed there). */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export function secureCookies(): boolean {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
}

export function firebaseAdminConfig(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  // Hosts often store the PEM on one line with literal "\n": turn those back into newlines.
  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
}

/** The local OTP stub is opt-in and refused on production deployments. */
export function otpStubAllowed(): boolean {
  return process.env.AUTH_OTP_STUB === "true" && !isProductionDeployment();
}

export function supabaseStorageConfig(): {
  url: string;
  serviceKey: string;
  bucket: string;
} | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return {
    url: url.replace(/\/$/, ""),
    serviceKey,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "uploads",
  };
}

/** Feature flag for paid entry (Phase 6). */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "true";
}

export function cashfreeEnv(): "sandbox" | "production" {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

export function cashfreePgConfig(): { appId: string; secretKey: string } | null {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  return appId && secretKey ? { appId, secretKey } : null;
}

export function cashfreePayoutsConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.CASHFREE_PAYOUTS_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_PAYOUTS_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Payouts above this (paise) need two different admins. Default INR 5,000. */
export function payoutTwoStepThresholdPaise(): number {
  const v = Number(process.env.PAYOUT_TWO_STEP_THRESHOLD_PAISE);
  return Number.isFinite(v) && v >= 0 ? v : 500_000;
}

export function siteUrlServer(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}
