import { IntentLink as Link } from "@/components/common/intent-link";
import {
  activeFilterCount,
  scrimsHref,
  type ScrimDay,
  type ScrimsQuery,
} from "@/lib/scrims-filter";
import { cn } from "@/lib/utils";
import { ScrimFilterForm } from "./filter-form";
import { MobileFilters } from "./mobile-filters";

/** Date chips: Today, Tomorrow, then weekday + date, from the current IST day. Always a horizontal row. */
function DateChips({ days, query }: { days: ScrimDay[]; query: ScrimsQuery }) {
  return (
    <nav aria-label="Date" className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="hidden text-sm font-semibold sm:block">
        Date
      </span>
      <ul className="-mx-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {days.map((d) => {
          const active = d.key === query.date;
          return (
            <li key={d.key} className="shrink-0">
              <Link
                href={scrimsHref(query, { date: d.key })}
                scroll={false}
                aria-current={active ? "date" : undefined}
                className={cn(
                  "min-h-tap flex min-w-18 flex-col items-center justify-center rounded-lg border px-3 py-1 text-center leading-tight transition-colors",
                  active
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-border bg-background hover:border-gold",
                )}
              >
                <span className="text-xs font-semibold">{d.label}</span>{" "}
                <span className="text-muted-foreground text-xs">{d.date}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The design's single rounded filter panel: date chips, then Mode / Entry Fee / Prize Pool / Status,
 * search and Reset. Below lg the dropdowns collapse into a "Filters" button with a bottom sheet;
 * the date chips stay visible. Everything lives in the URL query string.
 */
export function FilterPanel({ days, query }: { days: ScrimDay[]; query: ScrimsQuery }) {
  return (
    <section
      aria-label="Scrim filters"
      className="card-ds flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:gap-4 lg:p-4"
    >
      <div className="lg:border-border lg:border-r lg:pr-4">
        <DateChips days={days} query={query} />
      </div>
      <div className="hidden flex-1 lg:flex">
        <ScrimFilterForm query={query} layout="bar" idPrefix="bar" />
      </div>
      <div className="lg:hidden">
        <MobileFilters query={query} active={activeFilterCount(query)} />
      </div>
    </section>
  );
}
