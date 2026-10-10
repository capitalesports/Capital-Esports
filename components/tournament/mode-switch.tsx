import { IntentLink as Link } from "@/components/common/intent-link";
import type { Game } from "@/lib/games";
import { gameModeLabel } from "@/lib/home";
import type { MatchMode } from "@/lib/match-modes";
import { chipClass } from "@/lib/ui";

/**
 * Links between this week's tournaments of one game: `?t=<id>`. Chips show the mode; when two
 * tournaments share a mode, they show the title as well.
 */
export function TournamentModeSwitch({
  game,
  basePath,
  tournaments,
  activeId,
}: {
  game: Game;
  basePath: string;
  tournaments: { id: string; mode: MatchMode; title: string }[];
  activeId: string;
}) {
  if (tournaments.length < 2) return null;
  const shared = (m: MatchMode) => tournaments.filter((t) => t.mode === m).length > 1;
  return (
    <nav aria-label="Tournament" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {tournaments.map((t, i) => (
          <li key={t.id}>
            <Link
              href={i === 0 ? basePath : `${basePath}?t=${t.id}`}
              aria-current={t.id === activeId ? "page" : undefined}
              className={chipClass(t.id === activeId)}
            >
              {gameModeLabel(game, t.mode)}
              {shared(t.mode) ? ` · ${t.title}` : ""}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
