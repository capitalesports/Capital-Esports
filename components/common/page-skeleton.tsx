import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic loading state. The header block mirrors PageHeader's spacing (py-6, h1 + description)
 * so swapping in the real page causes no visible layout shift.
 */
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="py-6">
        <Skeleton className="h-8 w-56 sm:h-9" />
        <Skeleton className="mt-1 h-6 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Loading state for table pages (leaderboards). */
export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="py-6">
        <Skeleton className="h-8 w-64 sm:h-9" />
        <Skeleton className="mt-1 h-6 w-72 max-w-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
