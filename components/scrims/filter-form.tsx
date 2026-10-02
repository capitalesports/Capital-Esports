"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { MODE_LABEL } from "@/lib/match-modes";
import {
  FEE_LABEL,
  modesFor,
  PRIZE_LABEL,
  SCRIM_FEES,
  SCRIM_PRIZES,
  SCRIM_STATUSES,
  STATUS_FILTER_LABEL,
  type ScrimsQuery,
} from "@/lib/scrims-filter";
import { GAME_CONFIG } from "@/lib/games";
import { cn } from "@/lib/utils";

/** Values that are the default for their field and so stay out of the URL. */
const DEFAULTS: Record<string, string> = {
  mode: "all",
  fee: "all",
  prize: "all",
  status: "all",
  sort: "start",
  view: "grid",
  q: "",
};

/** Turns a GET form into a client-side navigation with a clean query string (no JS: a normal GET submit). */
export function useQueryFormSubmit(onDone?: () => void) {
  const router = useRouter();
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, raw] of new FormData(e.currentTarget)) {
      const value = String(raw).trim();
      if (value && DEFAULTS[key] !== value) params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `/scrims?${qs}` : "/scrims", { scroll: false });
    onDone?.();
  };
}

/** Params kept as hidden fields: the ones set outside this form. */
export function HiddenQuery({ query, omit }: { query: ScrimsQuery; omit: (keyof ScrimsQuery)[] }) {
  const keep: [string, string | null][] = [
    ["game", query.game ? GAME_CONFIG[query.game].slug : null],
    ["date", query.date !== query.today ? query.date : null],
    ["mode", query.mode],
    ["fee", query.fee],
    ["prize", query.prize],
    ["status", query.status],
    ["q", query.q],
    ["sort", query.sort],
    ["view", query.view],
  ];
  return (
    <>
      {keep
        .filter(([k, v]) => v && v !== DEFAULTS[k] && !omit.includes(k as keyof ScrimsQuery))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v!} />
        ))}
    </>
  );
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const selectClass = "bg-background";

/**
 * Mode / Entry Fee / Prize Pool / Status dropdowns, search and Reset (design filter panel).
 * `bar`: one row on desktop, selects submit on change. `sheet`: stacked with an Apply button (mobile).
 */
export function ScrimFilterForm({
  query,
  layout,
  idPrefix,
  onDone,
}: {
  query: ScrimsQuery;
  layout: "bar" | "sheet";
  idPrefix: string;
  onDone?: () => void;
}) {
  const submit = useQueryFormSubmit(onDone);
  const bar = layout === "bar";
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form
      method="get"
      action="/scrims"
      role="search"
      aria-label="Filter scrims"
      onSubmit={submit}
      onChange={(e) => {
        if (bar && e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
      }}
      className={cn(
        bar
          ? "grid flex-1 grid-cols-[repeat(4,minmax(7rem,1fr))_minmax(10rem,1.3fr)_auto] items-end gap-3"
          : "grid gap-4",
      )}
    >
      <HiddenQuery query={query} omit={["mode", "fee", "prize", "status", "q"]} />
      <Field id={id("mode")} label="Mode">
        <NativeSelect
          key={query.game ?? "all"}
          id={id("mode")}
          name="mode"
          defaultValue={query.mode ?? "all"}
          className={selectClass}
        >
          <option value="all">All Modes</option>
          {modesFor(query.game).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("fee")} label="Entry Fee">
        <NativeSelect id={id("fee")} name="fee" defaultValue={query.fee} className={selectClass}>
          {SCRIM_FEES.map((f) => (
            <option key={f} value={f}>
              {FEE_LABEL[f]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("prize")} label="Prize Pool">
        <NativeSelect
          id={id("prize")}
          name="prize"
          defaultValue={query.prize}
          className={selectClass}
        >
          {SCRIM_PRIZES.map((p) => (
            <option key={p} value={p}>
              {PRIZE_LABEL[p]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("status")} label="Status">
        <NativeSelect
          id={id("status")}
          name="status"
          defaultValue={query.status}
          className={selectClass}
        >
          {SCRIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABEL[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("q")} label="Search">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <input
            id={id("q")}
            name="q"
            type="search"
            defaultValue={query.q}
            maxLength={64}
            placeholder="Search scrims…"
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border pr-3 pl-9 text-base outline-none focus-visible:ring-3 md:text-sm"
          />
        </div>
      </Field>
      <div className={cn("flex gap-2", !bar && "pt-2")}>
        {/* Selects apply on change in the bar; Apply covers the search box, the sheet and no-JS use. */}
        <Button
          type="submit"
          variant={bar ? "outline" : "default"}
          className={bar ? "sr-only focus:not-sr-only" : "flex-1"}
        >
          Apply
        </Button>
        <Button asChild variant="outline" className={cn(!bar && "flex-1")}>
          <Link href="/scrims" onClick={onDone}>
            Reset
          </Link>
        </Button>
      </div>
    </form>
  );
}
