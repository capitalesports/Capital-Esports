import { GAME_CONFIG, type Game } from "@/lib/games";
import { cn } from "@/lib/utils";

/** Game name as styled text in the game's accent colour (no logos are ever drawn). */
export function GameBadge({ game, className }: { game: Game; className?: string }) {
  const cfg = GAME_CONFIG[game];
  return (
    <span
      className={cn(
        "font-heading text-sm font-bold tracking-wide whitespace-nowrap uppercase",
        cfg.accent.text,
        className,
      )}
    >
      {cfg.name}
    </span>
  );
}
