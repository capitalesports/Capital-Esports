/** Pages that require a logged-in user (checked optimistically in proxy.ts). */
export const PROTECTED_PREFIXES = ["/dashboard", "/profile", "/notifications", "/admin"] as const;

/** Protected as an exact path only: /teams (my teams) needs login, public /teams/<id> pages don't. */
export const PROTECTED_EXACT = ["/teams"] as const;

export function isProtectedPath(pathname: string): boolean {
  if ((PROTECTED_EXACT as readonly string[]).includes(pathname)) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
