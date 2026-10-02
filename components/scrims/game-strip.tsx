import { GameStripCard } from "@/components/game/game-strip-card";
import { GAME_LIST, type Game } from "@/lib/games";
import { isHeadToHead, MODE_LABEL, MODES_FOR_GAME } from "@/lib/match-modes";
import { scrimsHref, type ScrimsQuery } from "@/lib/scrims-filter";

/** Name of each game's head-to-head custom-room mode (Valorant is head-to-head only). */
const HEAD_TO_HEAD_NAME: Record<Game, string | null> = {
  FREE_FIRE: "Clash Squad",
  BGMI: "TDM",
  VALORANT: null,
};

/** "Battle Royale · Clash Squad" / "Battle Royale · TDM" / "Tactical · 1v1 · 2v2 · 5v5" */
export function gameStripSubtitle(game: Game): string {
  const h2h = HEAD_TO_HEAD_NAME[game];
  if (h2h) return `Battle Royale · ${h2h}`;
  const modes = MODES_FOR_GAME[game].filter(isHeadToHead).map((m) => MODE_LABEL[m]);
  return ["Tactical", ...modes].join(" · ");
}

/**
 * Three wide game cards (design): each in its game accent; clicking one filters the list to that game,
 * clicking the selected one again shows all games. A mode the new game doesn't have is dropped.
 */
export function GameStrip({ query }: { query: ScrimsQuery }) {
  return (
    <nav aria-label="Filter by game" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
      {GAME_LIST.map((g) => {
        const selected = query.game === g.id;
        const keepMode = query.mode && (selected || MODES_FOR_GAME[g.id].includes(query.mode));
        return (
          <GameStripCard
            key={g.id}
            game={g.id}
            href={scrimsHref(query, {
              game: selected ? null : g.id,
              mode: keepMode ? query.mode : null,
            })}
            subtitle={gameStripSubtitle(g.id)}
            selected={selected}
            scroll={false}
          />
        );
      })}
    </nav>
  );
}
