import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasArtwork, type ArtworkName } from "@/lib/artwork";

/** Delivered artwork as a data: URI for ImageResponse (Satori), or null while the file is missing. */
export async function artworkDataUri(name: ArtworkName): Promise<string | null> {
  if (!hasArtwork(name)) return null;
  try {
    const file = await readFile(path.join(process.cwd(), "public", "art", `${name}.png`));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
}
