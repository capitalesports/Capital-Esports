import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/og/og-card";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";
import { getPublicMatch } from "@/server/queries/matches";
import { MODE_LABEL } from "@/lib/match-schema";
import { formatEntryFee, formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Match card";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const bg = await artworkDataUri("og-background");
  const match = await getPublicMatch((await params).id);
  if (!match)
    return new ImageResponse(
      <OgCard background={bg} game={null} eyebrow="Match" title="Match not found" lines={[]} />,
      { ...size, fonts: await ogFonts() },
    );
  return new ImageResponse(
    <OgCard
      background={bg}
      game={match.game}
      eyebrow={`${MODE_LABEL[match.mode]} scrim`}
      title={match.title}
      lines={[
        formatIST(match.startsAt),
        `Entry ${formatEntryFee(match.entryFeePaise)}${match.prizePaise ? ` · Prize ${formatINR(match.prizePaise)}` : ""} · ${match._count.registrations}/${match.maxSlots} slots`,
      ]}
    />,
    { ...size, fonts: await ogFonts() },
  );
}
