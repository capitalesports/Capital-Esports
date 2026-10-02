import { NextResponse } from "next/server";
import { readLocalFile } from "@/server/providers/storage";

/** Serves files written by the local-disk storage stub (dev/test only; production uses Supabase URLs). */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const { key } = await ctx.params;
  const file = await readLocalFile(key.join("/"));
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
