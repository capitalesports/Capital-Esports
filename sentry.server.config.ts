import * as Sentry from "@sentry/nextjs";

// Server + edge error reporting. Disabled unless a DSN is configured. No PII (cookies, IPs, bodies).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.05,
    // Never send session cookies, headers, request/response bodies, query strings or user info.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  });
}
