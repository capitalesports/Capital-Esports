export interface BanFields {
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason?: string | null;
  registrationBlockedUntil?: Date | null;
}

/** Account ban: cannot log in. bannedAt without bannedUntil is permanent. */
export function isAccountBanned(user: BanFields, now = new Date()): boolean {
  if (!user.bannedAt) return false;
  return user.bannedUntil === null || user.bannedUntil > now;
}

/** Strike block (or account ban): cannot register for matches. */
export function isRegistrationBlocked(user: BanFields, now = new Date()): boolean {
  if (isAccountBanned(user, now)) return true;
  return !!user.registrationBlockedUntil && user.registrationBlockedUntil > now;
}

export interface BanRecord {
  expiresAt: Date | null;
  liftedAt: Date | null;
}

export function isBanRecordActive(ban: BanRecord, now = new Date()): boolean {
  if (ban.liftedAt) return false;
  return ban.expiresAt === null || ban.expiresAt > now;
}

export function banMessage(user: BanFields): string {
  const until = user.bannedUntil
    ? ` until ${user.bannedUntil.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`
    : "";
  const reason = user.banReason ? ` Reason: ${user.banReason}.` : "";
  return `This account is banned${until}.${reason} Contact support if you think this is a mistake.`;
}
