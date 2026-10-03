import { NextResponse } from "next/server";
import { catchUpMatchStatuses } from "@/server/jobs/status-catch-up";

export const dynamic = "force-dynamic";

/**
 * For the keep-alive pingers (cron-job.org, GitHub Actions; DECISIONS M45): runs the same throttled
 * status catch-up a page view runs (registration open/close, 30-minute reminders, room notices) and
 * answers with a few bytes. Pinger services reject large responses such as a full page.
 * Public on purpose: it does nothing a visitor opening any page doesn't already trigger.
 */
export async function GET() {
  await catchUpMatchStatuses();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
