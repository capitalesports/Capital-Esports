/**
 * Public relaunch (DECISIONS M55): every account made before it was removed, so players sign up
 * again (the same email is fine). The login page says so until RELAUNCH_NOTICE_UNTIL.
 */
export const RELAUNCH_NOTICE_UNTIL = new Date("2026-12-31T18:30:00Z");

export function showRelaunchNotice(now = new Date()): boolean {
  return now < RELAUNCH_NOTICE_UNTIL;
}
