import { IntentLink as Link } from "@/components/common/intent-link";
import { ArrowRightIcon, CalendarDaysIcon, CalendarRangeIcon, LayoutGridIcon } from "lucide-react";
import { Artwork } from "@/components/common/artwork";
import { MatchCard } from "@/components/match/match-card";
import { Button } from "@/components/ui/button";
import {
  dayHeading,
  nextDayWithMatches,
  scrimsHref,
  type ScrimDay,
  type ScrimsQuery,
} from "@/lib/scrims-filter";
import type { PublicMatch } from "@/server/queries/matches";
import { SortSelect } from "./sort-select";

interface RowProps {
  matches: PublicMatch[];
  variant: "day" | "upcoming";
  now: Date;
  paymentsEnabled: boolean;
  label: string;
}

/** Four-column grid on desktop, a sideways-scrolling row on phones. */
function CardRow({ matches, variant, now, paymentsEnabled, label }: RowProps) {
  return (
    <ul
      aria-label={label}
      className="-mx-4 flex snap-x scroll-px-4 [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:scroll-px-0 sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-4"
    >
      {matches.map((m) => (
        <li key={m.id} className="w-[85%] shrink-0 snap-start sm:w-auto">
          <MatchCard match={m} paymentsEnabled={paymentsEnabled} now={now} variant={variant} />
        </li>
      ))}
    </ul>
  );
}

/** "No scrims yet for this day" with a link to the next day that has matches (or a reset). */
function DayEmpty({
  next,
  href,
  filtered,
}: {
  next: ScrimDay | null;
  href: string | null;
  filtered: boolean;
}) {
  return (
    <div className="card-ds flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
      <div className="relative size-16 shrink-0">
        <Artwork name="empty-no-matches" fit="contain" sizes="64px" />
      </div>
      <div className="flex-1">
        <p className="font-semibold">No scrims yet for this day</p>
        <p className="text-muted-foreground text-sm">
          {next
            ? "New scrims are added daily."
            : filtered
              ? "Nothing matches these filters in the next few days."
              : "New scrims are added daily. Check back soon."}
        </p>
      </div>
      {next && href ? (
        <Link
          href={href}
          scroll={false}
          className="min-h-tap text-gold hover:text-gold-hover inline-flex items-center gap-1.5 text-sm font-medium"
        >
          See {next.label === "Tomorrow" ? "tomorrow" : `${next.label}, ${next.date}`}{" "}
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      ) : filtered ? (
        <Link
          href="/scrims"
          className="min-h-tap text-gold hover:text-gold-hover inline-flex items-center text-sm font-medium"
        >
          Reset filters
        </Link>
      ) : null}
    </div>
  );
}

function SectionTitle({
  id,
  icon,
  title,
  note,
  sub,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  note?: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-gold [&_svg]:size-7">{icon}</span>
      <h2 id={id} className="text-2xl font-bold sm:text-3xl">
        {title}
        {note ? (
          <span className="text-muted-foreground ml-2 font-sans text-base font-medium sm:text-lg">
            {note}
          </span>
        ) : null}
      </h2>
      <p className="text-muted-foreground hidden text-sm md:block">{sub}</p>
      {children ? <div className="w-full sm:ml-auto sm:w-auto">{children}</div> : null}
    </div>
  );
}

interface SectionsProps {
  query: ScrimsQuery;
  days: ScrimDay[];
  byDay: Map<string, PublicMatch[]>;
  now: Date;
  paymentsEnabled: boolean;
  filtered: boolean;
}

/** The selected day ("Today's Scrims" by default) with the Sort by control. */
export function SelectedDaySection({
  query,
  days,
  byDay,
  now,
  paymentsEnabled,
  filtered,
}: SectionsProps) {
  const day = days.find((d) => d.key === query.date)!;
  const list = byDay.get(day.key) ?? [];
  const next = nextDayWithMatches(days, day.key, byDay);
  const title = dayHeading(day);
  return (
    <section aria-labelledby="day-heading">
      <SectionTitle
        id="day-heading"
        icon={<CalendarDaysIcon aria-hidden />}
        title={title}
        sub={
          day.label === "Today"
            ? "Join exciting scrims happening today. Don't miss out!"
            : "Plan ahead and register early."
        }
      >
        <SortSelect query={query} />
      </SectionTitle>
      {list.length ? (
        <CardRow
          matches={list}
          variant="day"
          now={now}
          paymentsEnabled={paymentsEnabled}
          label={title}
        />
      ) : (
        <DayEmpty
          next={next}
          href={next ? scrimsHref(query, { date: next.key }) : null}
          filtered={filtered}
        />
      )}
    </section>
  );
}

/**
 * "Upcoming Scrims (Next 3 Days)": the days after the selected one. "View Calendar" switches to a
 * grouped-by-day view (view=calendar in the URL); each empty day links to the next one with matches.
 */
export function UpcomingSection({
  query,
  days,
  byDay,
  now,
  paymentsEnabled,
  filtered,
}: SectionsProps) {
  const later = days.filter((d) => d.key > query.date);
  if (!later.length) return null;
  const list = later.flatMap((d) => byDay.get(d.key) ?? []);
  const calendar = query.view === "calendar";
  const note = `(Next ${later.length === 1 ? "Day" : `${later.length} Days`})`;
  return (
    <section aria-labelledby="upcoming-heading">
      <SectionTitle
        id="upcoming-heading"
        icon={<CalendarRangeIcon aria-hidden />}
        title="Upcoming Scrims"
        note={note}
        sub="Plan ahead and register for upcoming scrims."
      >
        <Button asChild variant="gold-outline">
          <Link href={scrimsHref(query, { view: calendar ? "grid" : "calendar" })} scroll={false}>
            {calendar ? <LayoutGridIcon aria-hidden /> : <CalendarDaysIcon aria-hidden />}
            {calendar ? "Grid View" : "View Calendar"}
          </Link>
        </Button>
      </SectionTitle>
      {calendar ? (
        <div className="space-y-6">
          {later.map((d) => {
            const dayList = byDay.get(d.key) ?? [];
            const next = nextDayWithMatches(later, d.key, byDay);
            return (
              <section
                key={d.key}
                id={`day-${d.key}`}
                aria-labelledby={`day-${d.key}-h`}
                className="scroll-mt-24"
              >
                <h3
                  id={`day-${d.key}-h`}
                  className="mb-3 flex items-baseline gap-2 text-xl font-bold"
                >
                  {d.label === "Tomorrow" ? "Tomorrow" : d.label}, {d.date}
                  <span className="text-muted-foreground font-sans text-sm font-normal">
                    {dayList.length} scrim{dayList.length === 1 ? "" : "s"}
                  </span>
                </h3>
                {dayList.length ? (
                  <CardRow
                    matches={dayList}
                    variant="upcoming"
                    now={now}
                    paymentsEnabled={paymentsEnabled}
                    label={`Scrims on ${d.label}, ${d.date}`}
                  />
                ) : (
                  <DayEmpty
                    next={next}
                    href={next ? `#day-${next.key}` : null}
                    filtered={filtered}
                  />
                )}
              </section>
            );
          })}
        </div>
      ) : list.length ? (
        <CardRow
          matches={list}
          variant="upcoming"
          now={now}
          paymentsEnabled={paymentsEnabled}
          label="Upcoming scrims"
        />
      ) : (
        <DayEmpty next={null} href={null} filtered={filtered} />
      )}
    </section>
  );
}
