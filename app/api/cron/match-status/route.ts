import { NextResponse } from "next/server";
import { checkCronAuth } from "@/server/cron";
import { runMatchStatusJob } from "@/server/jobs/match-status-job";
import { runNewMatchAlerts } from "@/server/jobs/new-match-alerts";
import { runReminderJob } from "@/server/jobs/reminder-job";

export const maxDuration = 60;

/** Every 5 minutes (vercel.json): time-driven match states, then 30-minute reminders and room notices. */
export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const transitions = await runMatchStatusJob();
  const reminders = await runReminderJob();
  const alerts = await runNewMatchAlerts();
  return NextResponse.json({
    ok: true,
    transitions: transitions.length,
    details: transitions,
    ...reminders,
    ...alerts,
  });
}
