import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "development") {
    startLocalCron();
  }
}

/**
 * Local dev has no Vercel Cron: call the match-status cron route every 30 s so registration opens,
 * closes and goes live on time while `npm run dev` runs (DECISIONS M27). Production uses vercel.json.
 */
function startLocalCron() {
  const g = globalThis as { __localCron?: ReturnType<typeof setInterval> };
  const secret = process.env.CRON_SECRET;
  if (g.__localCron || !secret) return;
  const url = `http://localhost:${process.env.PORT ?? 3100}/api/cron/match-status`;
  g.__localCron = setInterval(() => {
    fetch(url, { headers: { authorization: `Bearer ${secret}` } }).catch(() => {
      // Server still starting or restarting: the next tick tries again.
    });
  }, 30_000);
}

/** Reports server component / route handler errors to Sentry (no-op without a DSN). */
export const onRequestError = Sentry.captureRequestError;
