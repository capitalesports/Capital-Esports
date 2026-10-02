"use client";

import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { SCRIM_SORTS, SORT_LABEL, type ScrimsQuery } from "@/lib/scrims-filter";
import { HiddenQuery, useQueryFormSubmit } from "./filter-form";

/** "Sort by: Start Time" in the section header; applies on change (Apply button without JS). */
export function SortSelect({ query }: { query: ScrimsQuery }) {
  const submit = useQueryFormSubmit();
  return (
    <form
      method="get"
      action="/scrims"
      onSubmit={submit}
      onChange={(e) => e.currentTarget.requestSubmit()}
      className="flex items-center gap-2"
    >
      <HiddenQuery query={query} omit={["sort"]} />
      <label htmlFor="scrim-sort" className="text-muted-foreground text-sm whitespace-nowrap">
        Sort by
      </label>
      <NativeSelect
        id="scrim-sort"
        name="sort"
        defaultValue={query.sort}
        className="bg-background w-40"
      >
        {SCRIM_SORTS.map((s) => (
          <option key={s} value={s}>
            {SORT_LABEL[s]}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" className="sr-only focus:not-sr-only">
        Apply
      </Button>
    </form>
  );
}
