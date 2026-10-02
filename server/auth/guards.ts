import "server-only";
import { notFound, redirect } from "next/navigation";
import { canAccessAdminPath } from "@/lib/admin-nav";
import { assertAdmin, assertModerator, assertUser, type Actor } from "@/lib/roles";
import { getCurrentUser, toActor, type SessionUser } from "./session";

/**
 * Guards for server actions and route handlers. Each throws an AppError
 * (UNAUTHENTICATED / FORBIDDEN) that the action wrapper turns into a response.
 */
export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser();
  return assertUser(user ? toActor(user) : null);
}

export async function requireModerator(): Promise<Actor> {
  const user = await getCurrentUser();
  return assertModerator(user ? toActor(user) : null);
}

export async function requireAdmin(): Promise<Actor> {
  const user = await getCurrentUser();
  return assertAdmin(user ? toActor(user) : null);
}

/** For pages: redirect to /login (with returnTo) when logged out. */
export async function requirePageUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}

/** For admin pages: staff only, and moderators only in their sections (others 404). */
export async function requireStaffPage(pathname: string): Promise<SessionUser> {
  const user = await requirePageUser(pathname);
  if (user.role === "PLAYER") notFound();
  if (!canAccessAdminPath(user.role, pathname)) notFound();
  return user;
}
