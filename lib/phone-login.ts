/**
 * Phone login can be switched off (NEXT_PUBLIC_PHONE_LOGIN=off) while Firebase has no billing
 * account, because new Firebase projects send no SMS without one (DECISIONS M37).
 */
export function phoneLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_LOGIN !== "off";
}
