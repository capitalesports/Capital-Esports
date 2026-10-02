import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/og/og-card";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";
import { db } from "@/server/db";
import { playerStanding } from "@/server/services/leaderboard";
import { gameFromSlug, isBattleRoyale } from "@/lib/games";

/** Shareable "rank card" image for a player in a game's current season. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/leaderboard/[game]/card/[userId]">,
) {
  const { game: slug, userId } = await ctx.params;
  const game = gameFromSlug(slug);
  const user = game
    ? await db.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { displayName: true },
      })
    : null;
  if (!game || !user) return new Response("Not found", { status: 404 });
  const s = await playerStanding(userId, game);
  const bg = await artworkDataUri("og-background");
  const rank = s?.rank ? `#${s.rank}` : "Unranked";
  const stats = s
    ? [
        `${s.points} points · ${s.matches} matches · ${s.wins} wins${isBattleRoyale(game) ? ` · ${s.kills} kills` : ""}`,
        s.season.name,
      ]
    : [];
  return new ImageResponse(
    <OgCard
      background={bg}
      game={game}
      eyebrow="Leaderboard"
      title={user.displayName ?? "Player"}
      big={rank}
      lines={stats}
    />,
    {
      ...OG_SIZE,
      fonts: await ogFonts(),
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
