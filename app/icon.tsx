import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/og/app-icon";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Browser tab icon, from the same source as the PWA icons. */
export default async function Icon() {
  return new ImageResponse(<AppIcon px={32} art={await artworkDataUri("app-icon")} />, {
    ...size,
    fonts: await ogFonts(),
  });
}
