import { CrownIcon, MedalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rank cell content: crown for 1st, medals for 2nd and 3rd (the number stays for screen readers), plain numbers after. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  if (rank <= 3) {
    const Icon = rank === 1 ? CrownIcon : MedalIcon;
    return (
      <span
        data-rank-icon={rank === 1 ? "crown" : "medal"}
        className={cn("inline-flex items-center", RANK_TONE[rank], className)}
      >
        <Icon aria-hidden className="size-5" />
        <span className="sr-only">{rank}</span>
      </span>
    );
  }
  return <span className={cn("text-sm", className)}>{rank}</span>;
}

/** Gold, silver-ish (foreground) and bronze-ish (muted) from the design tokens only. */
const RANK_TONE: Record<number, string> = {
  1: "text-gold",
  2: "text-foreground",
  3: "text-muted-foreground",
};

export const PLACE_LABEL = ["Champion", "Runner-up", "Third"] as const;

/** Lucide icon for a podium place (replaces medal emoji). */
export function PlaceIcon({ place, className }: { place: number; className?: string }) {
  const Icon = place === 1 ? CrownIcon : MedalIcon;
  return (
    <Icon
      aria-hidden
      className={cn("size-4", RANK_TONE[place] ?? "text-muted-foreground", className)}
    />
  );
}
