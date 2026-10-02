import { STATUS_LABEL, type MatchStatus } from "@/lib/match-state";
import { cn } from "@/lib/utils";

const STYLE: Record<MatchStatus, string> = {
  UPCOMING: "bg-muted text-muted-foreground",
  REGISTRATION_OPEN: "bg-success/15 text-success",
  REGISTRATION_CLOSED: "bg-warning/15 text-warning",
  LIVE: "bg-destructive/15 text-destructive",
  RESULTS_PENDING: "bg-info/15 text-info",
  COMPLETED: "bg-primary/15 text-primary",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function StatusPill({ status, className }: { status: MatchStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        STYLE[status],
        className,
      )}
    >
      {status === "LIVE" ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}
