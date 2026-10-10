import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabaseStorageConfig, stubsForbidden } from "@/server/env";
import { AppError } from "@/server/errors";

/** Object storage for avatars and result screenshots. */
export interface StorageProvider {
  readonly kind: "supabase" | "vercel-blob" | "local";
  /** Store bytes under `key` and return a URL that can be rendered in <img>. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

class SupabaseStorage implements StorageProvider {
  readonly kind = "supabase" as const;
  constructor(private cfg: { url: string; serviceKey: string; bucket: string }) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { url, serviceKey, bucket } = this.cfg;
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
        "x-upsert": "true",
        "Cache-Control": "max-age=31536000",
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new AppError("UNAVAILABLE", "Upload failed. Please try again.");
    return `${url}/storage/v1/object/public/${bucket}/${key}`;
  }
}

/**
 * Vercel Blob (DECISIONS M35): storage that lives in the same Vercel account as the site.
 * `BLOB_READ_WRITE_TOKEN` is set by Vercel when a Blob store is connected to the project.
 */
class VercelBlobStorage implements StorageProvider {
  readonly kind = "vercel-blob" as const;
  constructor(private token: string) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    try {
      const blob = await put(key, Buffer.from(bytes), {
        access: "public",
        token: this.token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31536000,
      });
      return blob.url;
    } catch {
      throw new AppError("UNAVAILABLE", "Upload failed. Please try again.");
    }
  }
}

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".uploads");

/** Dev/test stub: writes to ./.uploads and serves through /api/files/[...key]. */
class LocalDiskStorage implements StorageProvider {
  readonly kind = "local" as const;

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const file = localPathForKey(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.type`, contentType);
    return `/api/files/${key}`;
  }
}

/** Resolve a key inside the upload dir, refusing path traversal. */
export function localPathForKey(key: string): string {
  const file = path.resolve(LOCAL_UPLOAD_DIR, key);
  if (!file.startsWith(LOCAL_UPLOAD_DIR + path.sep)) throw new AppError("NOT_FOUND", "Not found");
  return file;
}

export async function readLocalFile(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const file = localPathForKey(key);
    const [bytes, contentType] = await Promise.all([
      readFile(file),
      readFile(`${file}.type`, "utf8"),
    ]);
    return { bytes, contentType };
  } catch {
    return null;
  }
}

export function getStorage(): StorageProvider {
  const cfg = supabaseStorageConfig();
  if (cfg) return new SupabaseStorage(cfg);
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) return new VercelBlobStorage(blobToken);
  if (stubsForbidden()) throw new AppError("UNAVAILABLE", "File uploads are not configured.");
  return new LocalDiskStorage();
}
