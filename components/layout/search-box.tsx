import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Navbar search (plain GET form → /search, works without JavaScript). */
export function SearchBox({ className, id = "site-search" }: { className?: string; id?: string }) {
  return (
    <form action="/search" method="get" role="search" className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        Search players, teams or matches
      </label>
      <SearchIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <input
        id={id}
        name="q"
        type="search"
        placeholder="Search players, teams or matches..."
        className="border-border bg-surface text-foreground placeholder:text-muted-foreground focus:border-gold h-11 w-full rounded-lg border pr-3 pl-9 text-sm focus:outline-none"
      />
    </form>
  );
}
