"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ScrimsQuery } from "@/lib/scrims-filter";
import { ScrimFilterForm } from "./filter-form";

/** Mobile bottom sheet with the filter panel; loaded on first tap of "Filters". */
export default function FilterSheet({
  query,
  open,
  onOpenChange,
}: {
  query: ScrimsQuery;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="border-border bg-background max-h-[85vh] overflow-y-auto rounded-t-xl p-4"
      >
        <SheetTitle className="font-heading text-2xl uppercase">Filters</SheetTitle>
        <SheetDescription className="sr-only">
          Filter scrims by mode, entry fee, prize pool, status or name.
        </SheetDescription>
        <ScrimFilterForm
          query={query}
          layout="sheet"
          idPrefix="sheet"
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
