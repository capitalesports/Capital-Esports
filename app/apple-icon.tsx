import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/og/app-icon";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon. */
export default async function AppleIcon() {
  return new ImageResponse(<AppIcon px={180} art={await artworkDataUri("app-icon")} />, {
    ...size,
    fonts: await ogFonts(),
  });
}
