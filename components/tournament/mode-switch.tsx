import { IntentLink as Link } from "@/components/common/intent-link";
import type { Game } from "@/lib/games";
import { gameModeLabel } from "@/lib/home";
import type { MatchMode } from "@/lib/match-modes";
import { chipClass } from "@/lib/ui";

/** Links between this week's tournaments of one game (one per mode): `?mode=ONE_V_ONE` etc. */
export function TournamentModeSwitch({
  game,
  basePath,
  modes,
  active,
}: {
  game: Game;
  basePath: string;
  modes: MatchMode[];
  active: MatchMode;
}) {
  if (modes.length < 2) return null;
  return (
    <nav aria-label="Tournament mode" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {modes.map((m, i) => (
          <li key={m}>
            <Link
              href={i === 0 ? basePath : `${basePath}?mode=${m}`}
              aria-current={m === active ? "page" : undefined}
              className={chipClass(m === active)}
            >
              {gameModeLabel(game, m)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
