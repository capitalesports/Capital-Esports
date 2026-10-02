import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listPointsConfigs } from "@/server/services/points-config";
import { PointsForm } from "./points-form";

export const metadata: Metadata = { title: "Points" };

export default async function AdminPointsPage() {
  const user = await requireStaffPage("/admin/points");
  const configs = await listPointsConfigs(toActor(user));
  return (
    <>
      <PageHeader
        title="Points"
        description="How approved results score on the leaderboard. Changes apply to results approved from now on; points already awarded stay."
      />
      <p className="text-muted-foreground mb-4 max-w-3xl text-sm">
        Lobby modes (Solo, Duo, Squad) score placement points plus points per kill. Head-to-head
        modes (1v1, 2v2, 4v4, 5v5) score win or loss points instead. Tournament matches multiply
        either score by the tournament multiplier.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {configs.map(({ game, config }) => (
          <PointsForm
            key={game}
            game={game}
            initial={{
              placementPoints: config.placementPoints.join(", "),
              killPoints: String(config.killPoints),
              winPoints: String(config.winPoints),
              lossPoints: String(config.lossPoints),
              tournamentMultiplier: String(config.tournamentMultiplier),
            }}
          />
        ))}
      </div>
    </>
  );
}
