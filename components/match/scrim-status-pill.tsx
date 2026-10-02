import type { ScrimPill, ScrimStatus } from "@/lib/scrims-filter";
import { cn } from "@/lib/utils";

const LABEL: Record<ScrimStatus, string> = {
  open: "Registration open",
  "almost-full": "Almost full",
  waitlist: "Waitlist",
  closed: "Closed",
  live: "Live",
  upcoming: "Upcoming",
};

// Design: REGISTRATION OPEN green, ALMOST FULL red, WAITLIST amber (the gold token), CLOSED and UPCOMING grey, LIVE red pulsing.
const GREY = "border-border bg-border/60 text-muted-foreground";
const STYLE: Record<ScrimStatus, string> = {
  open: "border-success/50 bg-success/15 text-success",
  "almost-full": "border-destructive bg-destructive text-foreground",
  waitlist: "border-gold/50 bg-gold/15 text-gold",
  closed: GREY,
  live: "border-destructive bg-destructive text-foreground",
  upcoming: GREY,
};

/** Top-right pill on scrim cards, with an optional note under it ("Opens at 5:30 PM"). */
export function ScrimStatusPill({ pill, className }: { pill: ScrimPill; className?: string }) {
  const { status, note } = pill;
  return (
    <span className={cn("flex flex-col items-end gap-0.5", className)}>
      <span
        data-status={status}
        className={cn(
          "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase",
          STYLE[status],
          status === "live" && "animate-pulse",
        )}
      >
        {status === "live" ? (
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
        ) : null}
        {LABEL[status]}
      </span>
      {note ? (
        // Dark backing: the note sits over the card art and must stay readable.
        <span className="border-border bg-background/90 text-foreground rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap">
          {note}
        </span>
      ) : null}
    </span>
  );
}
