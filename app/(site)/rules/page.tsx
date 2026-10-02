import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { Markdown } from "@/components/content/markdown";
import { GameBadge } from "@/components/game/game-badge";
import { getContent } from "@/server/services/content";
import type { ContentKey } from "@/lib/content";
import { DEFAULT_CONTENT } from "@/lib/default-content";
import { gameFromSlug, GAME_CONFIG, GAME_LIST } from "@/lib/games";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Rules & scoring",
  description: "Per-game rules, scoring, no-show and dispute policy.",
};

export default async function RulesPage({ searchParams }: PageProps<"/rules">) {
  const slug = (await searchParams).game;
  const game = gameFromSlug(typeof slug === "string" ? slug : null) ?? "FREE_FIRE";
  const key = `rules.${game}` as ContentKey;
  const [gameRules, general] = await Promise.all([getContent(key), getContent("rules.general")]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Rules & scoring"
        description="Per-game rules, how points work, and our no-show and dispute policy."
      />
      <nav aria-label="Game rules" className="mb-6 flex gap-2 overflow-x-auto">
        {GAME_LIST.map((g) => (
          <Link
            key={g.id}
            href={`/rules?game=${g.slug}`}
            aria-current={g.id === game ? "page" : undefined}
            className={cn(
              "min-h-tap inline-flex shrink-0 items-center rounded-full border px-4 text-sm",
              g.id === game
                ? cn(g.accent.bg, "border-transparent")
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {g.name}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="game-rules-h" className="space-y-3">
        <h2 id="game-rules-h" className="flex items-center gap-2 text-lg font-semibold">
          <GameBadge game={game} /> {GAME_CONFIG[game].name}
        </h2>
        <Markdown className="text-base">{gameRules || DEFAULT_CONTENT[key]}</Markdown>
      </section>
      <section
        aria-label="Scoring, no-shows and disputes"
        className="border-border mt-10 border-t pt-6"
      >
        <Markdown className="text-base">{general || DEFAULT_CONTENT["rules.general"]}</Markdown>
      </section>
    </div>
  );
}
