import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { secureCookies, sessionSecret } from "@/server/env";
import { isAccountBanned } from "@/lib/bans";
import type { Actor } from "@/lib/roles";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/session-token";

export async function issueSessionCookie(
  userId: string,
): Promise<{ name: string; value: string; options: ReturnType<typeof sessionCookieOptions> }> {
  return {
    name: SESSION_COOKIE,
    value: await signSession(userId, sessionSecret()),
    options: sessionCookieOptions(secureCookies()),
  };
}

const sessionUserSelect = {
  id: true,
  phone: true,
  displayName: true,
  dateOfBirth: true,
  avatarUrl: true,
  role: true,
  strikes: true,
  bannedAt: true,
  bannedUntil: true,
  banReason: true,
  registrationBlockedUntil: true,
  deletedAt: true,
  email: true,
  emailVerifiedAt: true,
  emailOptIn: true,
  gameProfiles: { select: { id: true, game: true, gameId: true, ign: true, region: true } },
} as const;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

function loadUser(id: string) {
  return db.user.findUnique({ where: { id }, select: sessionUserSelect });
}

/**
 * The logged-in user for this request, or null. Reloaded from the DB on every request
 * (deduplicated per render) so bans, merges and role changes apply immediately.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await verifySession(token, sessionSecret());
  if (!claims) return null;
  const user = await loadUser(claims.userId);
  if (!user || user.deletedAt || isAccountBanned(user)) return null;
  return user;
});

export function toActor(user: Pick<SessionUser, "id" | "role">): Actor {
  return { id: user.id, role: user.role };
}
