/* eslint-disable @next/next/no-img-element -- Satori (ImageResponse) renders plain <img> only */
import { DS, GAME_HEX } from "@/lib/design-tokens";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { BRAND_ACCENT, BRAND_REST } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 };

/** Loaded per request by the routes via `ogFonts()` (server/og-fonts.ts); Satori falls back to its default font for other glyphs. */
const HEADING = "Barlow Condensed";

/**
 * Shared 1200×630 social card used by match, tournament and rank-card images, in the design palette.
 * `background` is the og-background artwork as a data URI; while it is missing the card shows the
 * artwork placeholder look (surface, 1px border, faint gold glow). Game names are styled text, never logos.
 */
export function OgCard({
  game,
  eyebrow,
  title,
  lines,
  big,
  background = null,
}: {
  game: Game | null;
  eyebrow: string;
  title: string;
  lines: string[];
  big?: string;
  background?: string | null;
}) {
  const accent = game ? GAME_HEX[game] : DS.gold;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: DS.background,
        color: DS.text,
      }}
    >
      {background ? (
        <img
          src={background}
          alt=""
          width={OG_SIZE.width}
          height={OG_SIZE.height}
          style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 24,
            right: 24,
            bottom: 24,
            display: "flex",
            background: DS.surface,
            border: `1px solid ${DS.border}`,
            borderRadius: 12,
            boxShadow: "inset 0 0 120px rgba(232,179,58,0.10)",
          }}
        />
      )}
      {background ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            background:
              "linear-gradient(90deg, rgba(11,11,13,0.92) 0%, rgba(11,11,13,0.55) 70%, rgba(11,11,13,0.2) 100%)",
          }}
        />
      ) : null}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          padding: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontFamily: HEADING,
            fontSize: 36,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          {game ? <span style={{ color: accent }}>{GAME_CONFIG[game].name}</span> : null}
          <span style={{ color: DS.textSecondary }}>{eyebrow}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {big ? (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                fontFamily: HEADING,
                fontSize: 150,
                fontWeight: 800,
                color: DS.gold,
                lineHeight: 1,
              }}
            >
              {/* Barlow has no ₹ glyph: the sign gets its own run so only it uses the fallback font. */}
              {big
                .split(/(₹)/)
                .filter(Boolean)
                .map((part, i) => (
                  <span
                    key={i}
                    style={part === "₹" ? { fontSize: 120, marginRight: 6 } : undefined}
                  >
                    {part}
                  </span>
                ))}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: HEADING,
              fontSize: 80,
              fontWeight: 800,
              lineHeight: 1,
              textTransform: "uppercase",
            }}
          >
            {title}
          </div>
          {lines.map((l) => (
            <div key={l} style={{ fontSize: 32, color: DS.textSecondary }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 6, background: DS.gold, borderRadius: 3 }} />
          <div
            style={{
              display: "flex",
              fontFamily: HEADING,
              fontSize: 40,
              fontWeight: 800,
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: DS.gold }}>{BRAND_ACCENT}</span>
            <span style={{ marginLeft: 12 }}>{BRAND_REST}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
