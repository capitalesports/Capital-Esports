import "server-only";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import type { GoogleProfile } from "@/server/auth/google-verifier";
import { isProfileComplete } from "@/lib/profile";
import { displayNameSchema } from "@/lib/validators";
import { assertAccountCanLogIn, assertPhoneNotBanned } from "./auth";

export interface GoogleLoginOutcome {
  id: string;
  isNew: boolean;
  profileComplete: boolean;
}

/**
 * "Continue with Google" (DECISIONS M29, M31). An account already linked to this Google account, or
 * whose verified email is this Google email, logs straight in (and gets linked). Anyone else gets a
 * new account straight away, without a phone: name, verified email and photo come from Google.
 * A banned email can't sign in or sign up again.
 */
export async function loginWithGoogle(profile: GoogleProfile): Promise<GoogleLoginOutcome> {
  const user =
    (await db.user.findUnique({
      where: { googleId: profile.sub },
      include: { gameProfiles: { select: { game: true } } },
    })) ??
    (await db.user.findFirst({
      where: { email: profile.email, emailVerifiedAt: { not: null } },
      include: { gameProfiles: { select: { game: true } } },
    }));
  if (user) {
    await assertPhoneNotBanned(user.phone, user.email);
    assertAccountCanLogIn(user);
    const profileComplete = user.googleId
      ? isProfileComplete(user)
      : await attachGoogleProfile(user.id, profile);
    return { id: user.id, isNew: false, profileComplete };
  }

  await assertPhoneNotBanned(null, profile.email);
  let id: string;
  try {
    id = (await db.user.create({ data: { googleId: profile.sub } })).id;
  } catch {
    // The same Google account signing up twice at once: the other request created it.
    id = (await db.user.findUniqueOrThrow({ where: { googleId: profile.sub } })).id;
  }
  const profileComplete = await attachGoogleProfile(id, profile);
  return { id, isNew: true, profileComplete };
}

/** A usable display name from the Google name: the full name, else the first name, else none. */
export function nameFromGoogle(name: string | null): string | null {
  if (!name) return null;
  for (const candidate of [name, name.trim().split(/\s+/)[0] ?? ""]) {
    const parsed = displayNameSchema.safeParse(candidate.slice(0, 30));
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Link a Google account to a user and fill what's still empty: verified email, display name and
 * avatar. Never overwrites what the player set, and never takes an email or Google account that
 * another account already uses. Date of birth isn't shared by Google: the profile asks for it.
 * Returns whether the profile is now complete.
 */
export async function attachGoogleProfile(userId: string, profile: GoogleProfile): Promise<boolean> {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const [googleOwner, emailOwner] = await Promise.all([
      tx.user.findUnique({ where: { googleId: profile.sub }, select: { id: true } }),
      tx.user.findUnique({ where: { email: profile.email }, select: { id: true } }),
    ]);
    const data: {
      googleId?: string;
      email?: string;
      emailVerifiedAt?: Date;
      displayName?: string;
      avatarUrl?: string;
    } = {};
    if (!user.googleId && (!googleOwner || googleOwner.id === userId)) data.googleId = profile.sub;
    if (!user.email && !emailOwner) {
      data.email = profile.email;
      data.emailVerifiedAt = new Date();
    } else if (user.email === profile.email && !user.emailVerifiedAt) {
      data.emailVerifiedAt = new Date();
    }
    const name = user.displayName ? null : nameFromGoogle(profile.name);
    if (name) data.displayName = name;
    if (!user.avatarUrl && profile.picture?.startsWith("https://")) data.avatarUrl = profile.picture;
    if (!Object.keys(data).length) return;
    await tx.user.update({ where: { id: userId }, data });
    await writeAudit(tx, {
      actorId: userId,
      action: "user.google.link",
      entityType: "User",
      entityId: userId,
      before: { googleId: user.googleId, email: user.email, displayName: user.displayName },
      after: { fields: Object.keys(data) },
    });
  });
  const fresh = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { gameProfiles: { select: { game: true } } },
  });
  return isProfileComplete(fresh);
}
