/* eslint-disable @next/next/no-img-element -- Satori (ImageResponse) renders plain <img> only */
import { DS } from "@/lib/design-tokens";
import { SITE_NAME } from "@/lib/site";

/**
 * App icon for ImageResponse: the delivered `app-icon` artwork when present, otherwise the brand's first
 * letter in gold on the design background. `pad` keeps content inside the maskable safe zone.
 */
export function AppIcon({ px, pad = 0, art }: { px: number; pad?: number; art: string | null }) {
  const inner = px - pad * 2;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: DS.background,
      }}
    >
      {art ? (
        // app-icon.png is a rounded square on opaque white corners: a larger rounded mask clips them away.
        <div
          style={{
            width: inner,
            height: inner,
            display: "flex",
            borderRadius: inner * 0.22,
            overflow: "hidden",
          }}
        >
          <img src={art} alt="" width={inner} height={inner} style={{ objectFit: "cover" }} />
        </div>
      ) : (
        <div
          style={{
            width: inner,
            height: inner,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: inner * 0.22,
            background: DS.surface,
            border: `${Math.max(1, Math.round(inner / 40))}px solid ${DS.gold}`,
            color: DS.gold,
            fontFamily: "Barlow Condensed",
            fontSize: inner * 0.72,
            fontWeight: 800,
          }}
        >
          {SITE_NAME.slice(0, 1)}
        </div>
      )}
    </div>
  );
}
