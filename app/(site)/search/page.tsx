import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { SearchBox } from "@/components/layout/search-box";
import { StatusPill } from "@/components/match/status-pill";
import { normaliseQuery, searchSite } from "@/server/queries/search";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

function Section({
  title,
  children,
  count,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-xl font-bold">
        {title} <span className="text-muted-foreground text-sm font-normal">({count})</span>
      </h2>
      {count === 0 ? (
        <p className="text-muted-foreground text-sm">No {title.toLowerCase()} found.</p>
      ) : (
        children
      )}
    </section>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const q = normaliseQuery(raw);
  const results = q ? await searchSite(q) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Search"
        description={q ? `Results for “${q}”` : "Find players, teams or matches."}
      />
      <SearchBox id="page-search" className="mb-8" />
      {!results ? (
        <EmptyState
          title="Type at least 2 characters"
          description="Search by player name, in-game name, team or match title."
        />
      ) : (
        <div className="space-y-10">
          <Section title="Players" count={results.players.length}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {results.players.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/players/${p.id}`}
                    className="card-ds-interactive min-h-tap flex items-center gap-3 p-3"
                  >
                    <span className="font-semibold">{p.displayName ?? "Player"}</span>
                    <span className="ml-auto flex gap-1">
                      {p.gameProfiles.map((g) => (
                        <GameBadge key={g.game} game={g.game} />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Teams" count={results.teams.length}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {results.teams.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/teams/${t.id}`}
                    className="card-ds-interactive min-h-tap flex items-center gap-3 p-3"
                  >
                    <GameBadge game={t.game} />
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {t._count.members} players
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Matches" count={results.matches.length}>
            <ul className="space-y-2">
              {results.matches.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/scrims/${m.id}`}
                    className="card-ds-interactive min-h-tap flex flex-wrap items-center gap-3 p-3"
                  >
                    <GameBadge game={m.game} />
                    <span className="font-semibold">{m.title}</span>
                    <span className="text-muted-foreground text-sm">{formatIST(m.startsAt)}</span>
                    <span className="ml-auto">
                      <StatusPill status={m.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}
