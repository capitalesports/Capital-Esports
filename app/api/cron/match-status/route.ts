import { NextResponse } from "next/server";
import { checkCronAuth } from "@/server/cron";
import { runMatchStatusJob } from "@/server/jobs/match-status-job";
import { runReminderJob } from "@/server/jobs/reminder-job";

export const maxDuration = 60;

/** Every 5 minutes (vercel.json): time-driven match states, then 30-minute reminders and room notices. */
export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const transitions = await runMatchStatusJob();
  const reminders = await runReminderJob();
  return NextResponse.json({
    ok: true,
    transitions: transitions.length,
    details: transitions,
    ...reminders,
  });
}
