"use client";

import { useState } from "react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { ArrowRightIcon, CrownIcon } from "lucide-react";
import { chipClass } from "@/lib/ui";

export interface PreviewPanel {
  slug: string;
  name: string;
  table: React.ReactNode;
}

/** Home leaderboard block: "Leaderboard (Current season)", game tabs, top 5, View Full Leaderboard. */
export function LeaderboardPreview({ panels }: { panels: PreviewPanel[] }) {
  const [active, setActive] = useState(0);
  const current = panels[active]!;

  return (
    <section aria-labelledby="lb-heading" className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CrownIcon aria-hidden className="text-gold size-7" />
        <h2 id="lb-heading" className="text-2xl font-bold sm:text-3xl">
          Leaderboard
        </h2>
        <span className="font-heading text-muted-foreground text-sm tracking-wide uppercase">
          (Current season)
        </span>
        <Link
          href={`/leaderboard/${current.slug}`}
          className="min-h-tap text-gold hover:text-gold-hover ml-auto inline-flex items-center gap-1.5 text-sm font-medium"
        >
          View Full Leaderboard <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      <div
        role="tablist"
        aria-label="Leaderboard game"
        className="mt-3 flex gap-2 overflow-x-auto"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const next = (active + (e.key === "ArrowRight" ? 1 : panels.length - 1)) % panels.length;
          setActive(next);
          document.getElementById(`lb-tab-${panels[next]!.slug}`)?.focus();
        }}
      >
        {panels.map((p, i) => (
          <button
            key={p.slug}
            id={`lb-tab-${p.slug}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`lb-panel-${p.slug}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`${chipClass(i === active)} shrink-0`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div
          key={p.slug}
          id={`lb-panel-${p.slug}`}
          role="tabpanel"
          aria-labelledby={`lb-tab-${p.slug}`}
          hidden={i !== active}
          className="mt-3"
        >
          {/* Only the active table is in the DOM (less to hydrate); the others render from props on switch. */}
          {i === active ? p.table : null}
        </div>
      ))}
    </section>
  );
}
