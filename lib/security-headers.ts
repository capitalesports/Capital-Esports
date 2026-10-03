/**
 * Content-Security-Policy for pages. Scripts need the per-request nonce (plus 'strict-dynamic' so
 * Firebase's reCAPTCHA and Cashfree's checkout SDK, loaded by our bundled code, are allowed).
 * Host allow-lists cover only Firebase/Google auth, Cashfree, Razorpay, YouTube embeds, Supabase storage and Sentry.
 */
export const FIREBASE_HOSTS = [
  "https://www.google.com",
  "https://www.gstatic.com",
  "https://apis.google.com",
  "https://*.googleapis.com",
  "https://*.firebaseapp.com",
];
export const CASHFREE_HOSTS = ["https://sdk.cashfree.com", "https://*.cashfree.com"];
/** Razorpay Checkout: script, API, popup frames and its bank/UPI redirects (DECISIONS M43). */
export const RAZORPAY_HOSTS = ["https://checkout.razorpay.com", "https://*.razorpay.com"];
export const SUPABASE_HOSTS = ["https://*.supabase.co"];
export const SENTRY_HOSTS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
];
export const YOUTUBE_EMBED = "https://www.youtube-nocookie.com";

export function buildCsp(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...FIREBASE_HOSTS,
      ...CASHFREE_HOSTS,
      ...RAZORPAY_HOSTS,
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Inline style attributes (carousel transforms, toasts) need 'unsafe-inline'; scripts do not.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...FIREBASE_HOSTS,
      ...CASHFREE_HOSTS,
      ...RAZORPAY_HOSTS,
      ...SUPABASE_HOSTS,
      ...SENTRY_HOSTS,
    ],
    "frame-src": [
      "https://www.google.com",
      "https://*.firebaseapp.com",
      ...CASHFREE_HOSTS,
      ...RAZORPAY_HOSTS,
      YOUTUBE_EMBED,
    ],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...CASHFREE_HOSTS, ...RAZORPAY_HOSTS],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Static headers for every response (set in next.config.ts). */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://*.cashfree.com" "https://*.razorpay.com")',
  },
];
