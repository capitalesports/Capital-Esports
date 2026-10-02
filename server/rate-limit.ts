import "server-only";
import { db } from "./db";
import { AppError } from "./errors";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter stored in Postgres so it holds across serverless instances.
 * Each call consumes one unit.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = new Date(),
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: count <= limit, count, retryAfterSeconds };
}

/** Consume one unit or throw RATE_LIMITED with a friendly message. */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  message = "Too many attempts. Please wait a few minutes and try again.",
): Promise<void> {
  const result = await consumeRateLimit(key, limit, windowSeconds);
  if (!result.allowed) throw new AppError("RATE_LIMITED", message);
}

/** Delete windows older than a day (called from the maintenance cron). */
export async function pruneRateLimits(now = new Date()): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
  });
  return count;
}
