import { PlayerAvatar } from "@/components/common/player-avatar";
import { PLACE_LABEL, PlaceIcon } from "@/components/leaderboard/rank-badge";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PublishedWinner } from "@/server/services/tournaments";

export function WinnersList({ winners }: { winners: PublishedWinner[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {winners.map((w) => (
        <li
          key={w.place}
          className={cn("card-ds flex items-center gap-3 p-3", w.place === 1 && "border-gold")}
        >
          <PlayerAvatar name={w.name} src={w.avatarUrl} size={48} />
          <div className="min-w-0">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <PlaceIcon place={w.place} />
              {PLACE_LABEL[w.place - 1] ?? `#${w.place}`}
            </p>
            <p className="font-heading truncate text-lg uppercase">{w.name}</p>
            {w.prizePaise ? <p className="text-gold text-sm">{formatINR(w.prizePaise)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
