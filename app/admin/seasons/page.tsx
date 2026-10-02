import type { Metadata } from "next";
import { EndSeasonButton, StartSeasonForm } from "@/components/admin/season-controls";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { Button } from "@/components/ui/button";
import { requireStaffPage } from "@/server/auth/guards";
import { db } from "@/server/db";
import { GAMES } from "@/lib/games";
import { formatDateIST, istDayKey } from "@/lib/time";

export const metadata: Metadata = { title: "Seasons" };

export default async function AdminSeasonsPage() {
  await requireStaffPage("/admin/seasons");
  const seasons = await db.season.findMany({
    orderBy: { startsAt: "desc" },
    include: { _count: { select: { leaderboard: true } } },
  });

  return (
    <>
      <PageHeader
        title="Seasons"
        description="One 3-month season per game. Seasons roll over automatically at 00:05 IST after they end."
      />
      <div className="space-y-6">
        {GAMES.map((game) => {
          const list = seasons.filter((s) => s.game === game);
          const active = list.find((s) => s.isActive);
          return (
            <section key={game} aria-label={game} className="card-ds space-y-3 p-4">
              <GameBadge game={game} />
              {active ? null : (
                <StartSeasonForm
                  game={game}
                  defaultName={`Season ${list.length + 1}`}
                  defaultDate={istDayKey(new Date())}
                />
              )}
              <ul className="space-y-2">
                {list.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">
                      {formatDateIST(s.startsAt)} – {formatDateIST(s.endsAt)}
                    </span>
                    <span className={s.isActive ? "text-success" : "text-muted-foreground"}>
                      {s.isActive ? "Active" : "Archived"}
                    </span>
                    <span className="text-muted-foreground">{s._count.leaderboard} players</span>
                    <span className="ml-auto flex gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/admin/seasons/${s.id}/export`}>Export CSV</a>
                      </Button>
                      {s.isActive ? <EndSeasonButton seasonId={s.id} name={s.name} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
