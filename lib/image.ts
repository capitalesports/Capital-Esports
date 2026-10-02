/** Detect an image type from its magic bytes (never trust the file name or client MIME type). */

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const IMAGE_EXTENSION: Record<ImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" .... "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  return null;
}

export const MB = 1024 * 1024;
export const AVATAR_MAX_BYTES = 2 * MB;
export const SCREENSHOT_MAX_BYTES = 5 * MB;

export type ImageCheck = { ok: true; mime: ImageMime } | { ok: false; error: string };

export function checkImage(bytes: Uint8Array, maxBytes: number): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "Choose an image to upload." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `Image must be ${Math.round(maxBytes / MB)} MB or smaller.` };
  }
  const mime = detectImageMime(bytes);
  if (!mime) return { ok: false, error: "Only PNG, JPEG, WebP or GIF images are allowed." };
  return { ok: true, mime };
}
