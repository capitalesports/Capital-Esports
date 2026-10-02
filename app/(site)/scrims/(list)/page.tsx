import type { Metadata } from "next";
import { Suspense } from "react";
import { TrustRow } from "@/components/home/why-play";
import { FilterPanel } from "@/components/scrims/filter-panel";
import { GameStrip } from "@/components/scrims/game-strip";
import { ScrimsHero } from "@/components/scrims/scrims-hero";
import { SelectedDaySection, UpcomingSection } from "@/components/scrims/scrim-sections";
import { paymentsEnabled } from "@/server/env";
import { listUpcomingScrims } from "@/server/queries/matches";
import { getContent } from "@/server/services/content";
import { contentLink } from "@/lib/content";
import {
  activeFilterCount,
  filterScrims,
  groupByDay,
  parseScrimsQuery,
  scrimDays,
  sortScrims,
} from "@/lib/scrims-filter";

export const metadata: Metadata = {
  title: "Scrims",
  description: "Free Fire, BGMI and Valorant scrims today and for the next 3 days. Times in IST.",
};

/** /scrims per docs/design/pages/scrims-desktop.png. All filters come from the URL query string. */
export default async function ScrimsPage({ searchParams }: PageProps<"/scrims">) {
  const now = new Date();
  const query = parseScrimsQuery(await searchParams, now);
  const days = scrimDays(now);
  const payments = paymentsEnabled();
  const [all, video] = await Promise.all([listUpcomingScrims({}, now), getContent("scrims.video")]);
  const byDay = groupByDay(sortScrims(filterScrims(all, query, now, payments), query.sort), days);
  const filtered = query.game !== null || activeFilterCount(query) > 0;
  const sections = { query, days, byDay, now, paymentsEnabled: payments, filtered };

  return (
    <div className="space-y-6 pb-4 sm:space-y-8">
      <ScrimsHero videoUrl={contentLink(video)} />
      <GameStrip query={query} />
      <FilterPanel days={days} query={query} />
      {/* Nothing here suspends: the boundaries only let React hydrate each section as its own task. */}
      <Suspense>
        <SelectedDaySection {...sections} />
      </Suspense>
      <Suspense>
        <UpcomingSection {...sections} />
      </Suspense>
      <Suspense>
        <TrustRow />
      </Suspense>
    </div>
  );
}
