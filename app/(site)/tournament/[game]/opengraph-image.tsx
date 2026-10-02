import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/og/og-card";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";
import { getCurrentTournament } from "@/server/services/tournament-queries";
import { gameFromSlug, GAME_CONFIG } from "@/lib/games";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Weekly tournament";

export default async function Image({ params }: { params: Promise<{ game: string }> }) {
  const bg = await artworkDataUri("og-background");
  const game = gameFromSlug((await params).game);
  if (!game)
    return new ImageResponse(
      <OgCard
        background={bg}
        game={null}
        eyebrow="Tournament"
        title="Weekly tournaments"
        lines={[]}
      />,
      { ...size, fonts: await ogFonts() },
    );
  const t = await getCurrentTournament(game);
  return new ImageResponse(
    t ? (
      <OgCard
        background={bg}
        game={game}
        eyebrow="Weekly tournament"
        title={t.title}
        big={formatINR(t.prizePoolPaise)}
        lines={[`Starts ${formatIST(t.startsAt)}`]}
      />
    ) : (
      <OgCard
        background={bg}
        game={game}
        eyebrow="Weekly tournament"
        title={`${GAME_CONFIG[game].name} tournament`}
        lines={["Announced every week"]}
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
