import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/og/app-icon";
import { artworkDataUri } from "@/server/art-data";
import { ogFonts } from "@/server/og-fonts";

const SIZES: Record<string, { px: number; pad: number }> = {
  "192": { px: 192, pad: 0 },
  "512": { px: 512, pad: 0 },
  // Maskable icons keep the logo inside the central safe zone.
  maskable: { px: 512, pad: 96 },
};

/** App icons for the PWA manifest, rendered once and cached. */
export async function GET(_request: Request, ctx: RouteContext<"/icons/[size]">) {
  const spec = SIZES[(await ctx.params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  const art = await artworkDataUri("app-icon");
  return new ImageResponse(<AppIcon px={spec.px} pad={spec.pad} art={art} />, {
    width: spec.px,
    height: spec.px,
    fonts: await ogFonts(),
    headers: { "Cache-Control": "public, max-age=86400, immutable" },
  });
}
