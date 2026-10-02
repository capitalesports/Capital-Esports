"use client";

/**
 * Downscale an image in the browser before upload so request bodies stay small
 * (Vercel caps function payloads at 4.5 MB). Returns the original file if it is
 * already small or cannot be decoded; the server still validates size and magic bytes.
 */
export async function downscaleImage(
  file: File,
  maxDimension = 1600,
  skipBelowBytes = 600_000,
): Promise<Blob> {
  if (file.size <= skipBelowBytes || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
