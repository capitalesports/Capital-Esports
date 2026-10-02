import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Uptime probe: 200 when the app and database respond, 503 otherwise. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, db: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
