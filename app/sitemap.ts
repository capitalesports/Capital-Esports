import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { GAME_LIST } from "@/lib/games";
import { siteUrl } from "@/lib/site";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Public, indexable pages: static pages, game hubs, current matches and tournaments. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const statics = [
    "",
    "/scrims",
    "/tournament",
    "/leaderboard",
    "/games",
    "/rules",
    "/faq",
    "/terms",
    "/privacy",
    "/refund-policy",
    "/contact",
  ];
  const perGame = GAME_LIST.flatMap((g) => [
    `/games/${g.slug}`,
    `/tournament/${g.slug}`,
    `/tournament/${g.slug}/past`,
    `/leaderboard/${g.slug}`,
  ]);
  let matches: { id: string; updatedAt: Date }[] = [];
  try {
    matches = await db.match.findMany({
      where: {
        isEntryList: false,
        status: { not: "CANCELLED" },
        startsAt: { gte: addDays(now, -7), lte: addDays(now, 7) },
      },
      select: { id: true, updatedAt: true },
      take: 1000,
    });
  } catch {
    // Database unavailable: still serve the static entries.
  }
  return [
    ...[...statics, ...perGame].map((p) => ({
      url: `${base}${p}`,
      changeFrequency: "daily" as const,
    })),
    ...matches.map((m) => ({
      url: `${base}/scrims/${m.id}`,
      lastModified: m.updatedAt,
      changeFrequency: "hourly" as const,
    })),
  ];
}
