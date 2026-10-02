import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700 | 800; style: "normal" };

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let cache: Promise<OgFont[]> | null = null;

/**
 * Fonts for ImageResponse: Barlow Condensed 700/800 (OFL, assets/fonts; Satori reads WOFF, not WOFF2),
 * then next/og's own default font as a per-glyph fallback for characters Barlow lacks, such as ₹.
 * Paths are literals so the bundler traces only these files.
 */
export function ogFonts(): Promise<OgFont[]> {
  cache ??= Promise.all([
    readFile(path.join(process.cwd(), "assets", "fonts", "barlow-condensed-latin-700-normal.woff")),
    readFile(path.join(process.cwd(), "assets", "fonts", "barlow-condensed-latin-800-normal.woff")),
    readFile(
      path.join(
        process.cwd(),
        "node_modules",
        "next",
        "dist",
        "compiled",
        "@vercel",
        "og",
        "Geist-Regular.ttf",
      ),
    ),
  ]).then(([bold, extraBold, fallback]) => [
    { name: "Barlow Condensed", weight: 700, style: "normal", data: toArrayBuffer(bold) },
    { name: "Barlow Condensed", weight: 800, style: "normal", data: toArrayBuffer(extraBold) },
    { name: "Geist", weight: 400, style: "normal", data: toArrayBuffer(fallback) },
  ]);
  return cache;
}
