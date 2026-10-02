import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn();
vi.mock("node:fs/promises", () => ({ readFile: (...a: unknown[]) => readFile(...a) }));
const available = { list: [] as string[] };
vi.mock("@/lib/art-manifest", () => ({
  get AVAILABLE_ART() {
    return available.list;
  },
}));

afterEach(() => {
  readFile.mockReset();
  available.list = [];
});

describe("artworkDataUri (OG images and icons)", () => {
  it("returns null without touching the disk while the artwork is missing", async () => {
    const { artworkDataUri } = await import("@/server/art-data");
    expect(await artworkDataUri("og-background")).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("inlines a delivered file as a PNG data URI", async () => {
    available.list = ["app-icon"];
    readFile.mockResolvedValue(Buffer.from("png-bytes"));
    const { artworkDataUri } = await import("@/server/art-data");
    expect(await artworkDataUri("app-icon")).toBe(`data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
    expect(String(readFile.mock.calls[0]![0])).toBe(path.join(process.cwd(), "public", "art", "app-icon.png"));
  });

  it("falls back to the placeholder when the file can't be read", async () => {
    available.list = ["og-background"];
    readFile.mockRejectedValue(new Error("ENOENT"));
    const { artworkDataUri } = await import("@/server/art-data");
    expect(await artworkDataUri("og-background")).toBeNull();
  });
});
