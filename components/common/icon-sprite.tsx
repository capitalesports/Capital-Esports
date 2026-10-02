import { CalendarDaysIcon, ClockIcon, StarIcon, TrophyIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lucide icons repeated on every match card, rendered once as SVG symbols. A card then uses a 2-element
 * `<svg><use/></svg>` instead of a full icon (up to ~11 elements each): fewer DOM nodes for React to
 * hydrate on card-heavy pages. Colour follows `currentColor` like any lucide icon.
 */
const SPRITE = {
  trophy: TrophyIcon,
  star: StarIcon,
  clock: ClockIcon,
  "calendar-days": CalendarDaysIcon,
} satisfies Record<string, LucideIcon>;

export type SpriteIconName = keyof typeof SPRITE;

/** Rendered once per page (site layout). */
export function IconSprite() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      {Object.entries(SPRITE).map(([name, Icon]) => (
        <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
          <Icon />
        </symbol>
      ))}
    </svg>
  );
}

export function SpriteIcon({ name, className }: { name: SpriteIconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("shrink-0", className)}>
      <use href={`#i-${name}`} />
    </svg>
  );
}
