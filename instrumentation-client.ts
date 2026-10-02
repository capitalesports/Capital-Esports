// Browser error reporting; disabled unless NEXT_PUBLIC_SENTRY_DSN is set. No PII, no session replay.
// The SDK is loaded lazily so it never sits on the first-paint path (Lighthouse mobile budget).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

let captureTransition: ((href: string, navigationType: string) => void) | undefined;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.05,
      // Never send session cookies, headers, request/response bodies, query strings or user info.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
    captureTransition = Sentry.captureRouterTransitionStart;
  });
}

export function onRouterTransitionStart(href: string, navigationType: string) {
  captureTransition?.(href, navigationType);
}
