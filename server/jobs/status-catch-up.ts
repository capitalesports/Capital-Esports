import "server-only";

/** At most one catch-up run per server instance in this window. */
export const CATCH_UP_INTERVAL_MS = 20_000;

let lastRun = 0;
let running: Promise<void> | null = null;

/**
 * Apply time-driven match transitions (registration opens/closes, live, results pending) right when
 * a page or registration needs them, instead of waiting for the next 5-minute cron (DECISIONS M27).
 * Throttled per instance; concurrent callers share one run. Failures are logged, never thrown: the
 * cron job remains the safety net. Off in unit/integration tests, which drive the job themselves.
 */
export async function catchUpMatchStatuses(now = Date.now()): Promise<void> {
  if (process.env.VITEST || process.env.STATUS_CATCH_UP === "off") return;
  if (running) return running;
  if (now - lastRun < CATCH_UP_INTERVAL_MS) return;
  lastRun = now;
  running = (async () => {
    try {
      // Loaded on use: the jobs import services that import these queries (no import cycle).
      const [{ runMatchStatusJob }, { runReminderJob }, { runPaymentExpiryJob }] =
        await Promise.all([
          import("./match-status-job"),
          import("./reminder-job"),
          import("./payment-jobs"),
        ]);
      await runMatchStatusJob(new Date(now));
      await runReminderJob(new Date(now));
      // Unpaid entries lose their slot after the 10-minute window (the daily cron alone is too slow).
      await runPaymentExpiryJob(new Date(now));
      // Manual UPI payments (M54): slots whose proof never came in time are released.
      const { expireManualPayments } = await import("@/server/services/manual-payments");
      await expireManualPayments(new Date(now));
    } catch (e) {
      console.error("[status catch-up] failed", e);
    } finally {
      running = null;
    }
  })();
  return running;
}
