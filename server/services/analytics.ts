import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertAdmin, type Actor } from "@/lib/roles";

/** Funnel steps, recorded once per user. */
export const FUNNEL = ["LOGIN", "PROFILE_COMPLETE", "FIRST_REGISTRATION"] as const;
export type FunnelStep = (typeof FUNNEL)[number];

/** Record a funnel step the first time a user reaches it. Never throws. */
export async function trackOnce(name: FunnelStep, userId: string) {
  try {
    await db.analyticsEvent.create({ data: { name, userId } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"))
      console.error("analytics", e);
  }
}

/** Only first-party page paths, without query strings; admin pages are not tracked. */
export function normalisePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 200)
    return null;
  const path = raw.split(/[?#]/)[0]!;
  if (path.startsWith("/admin") || path.startsWith("/api")) return null;
  return path;
}

export async function recordPageView(path: string) {
  await db.analyticsEvent.create({ data: { name: "PAGE_VIEW", path } });
}

export async function analyticsSummary(actor: Actor | null, days = 7) {
  assertAdmin(actor);
  const since = new Date(Date.now() - days * 86400_000);
  const [views, topPaths, funnel] = await Promise.all([
    db.analyticsEvent.count({ where: { name: "PAGE_VIEW", createdAt: { gte: since } } }),
    db.analyticsEvent.groupBy({
      by: ["path"],
      where: { name: "PAGE_VIEW", createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 8,
    }),
    Promise.all(
      FUNNEL.map(async (name) => ({
        name,
        users: await db.analyticsEvent.count({ where: { name, createdAt: { gte: since } } }),
      })),
    ),
  ]);
  return {
    views,
    topPaths: topPaths.map((p) => ({ path: p.path ?? "", count: p._count._all })),
    funnel,
  };
}
