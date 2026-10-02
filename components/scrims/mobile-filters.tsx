"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScrimsQuery } from "@/lib/scrims-filter";

const FilterSheet = dynamic(() => import("./filter-sheet"), { ssr: false });

/** Below lg the filter panel collapses into this button; the sheet (Radix Dialog) loads on demand. */
export function MobileFilters({ query, active }: { query: ScrimsQuery; active: number }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => setLoaded(true)}
        onFocus={() => setLoaded(true)}
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        <SlidersHorizontalIcon aria-hidden />
        Filters
        {active ? (
          <span className="bg-gold text-background ml-1 rounded-full px-1.5 text-xs font-bold">
            {active}
            <span className="sr-only"> active</span>
          </span>
        ) : null}
      </Button>
      {loaded ? <FilterSheet query={query} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
