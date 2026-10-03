/**
 * Phone login is off unless switched on (NEXT_PUBLIC_PHONE_LOGIN=on). The owner removed phone
 * numbers from the site (DECISIONS M37), and new Firebase projects send no SMS without a billing
 * account. The e2e suite turns it on because its specs log in with the local OTP stub.
 */
export function phoneLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_LOGIN === "on";
}
