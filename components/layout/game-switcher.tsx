"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { usePathname } from "next/navigation";
import { GAME_LIST } from "@/lib/games";
import { currentSwitcherGame, switcherHref, switcherSection } from "@/lib/nav";
import { chipClass } from "@/lib/ui";

/** Game chips under the navbar on Tournament and Leaderboard pages (/scrims uses its game strip instead). */
export function GameSwitcher() {
  const pathname = usePathname();
  const section = switcherSection(pathname);
  if (!section) return null;

  const current = currentSwitcherGame(pathname);

  return (
    <nav aria-label="Game" className="border-border border-t">
      <ul className="page-container flex gap-2 overflow-x-auto py-2">
        {GAME_LIST.map((g) => {
          const active = g.id === current;
          return (
            <li key={g.id} className="shrink-0">
              <Link
                href={switcherHref(section, g.id)}
                aria-current={active ? "page" : undefined}
                className={chipClass(active)}
              >
                {g.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
