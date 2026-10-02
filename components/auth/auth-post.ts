import { safeReturnTo } from "@/lib/input-rules";

export interface AuthResponse {
  ok: boolean;
  error?: string;
  needsProfile?: boolean;
  email?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/** POST JSON to one of our /api/auth routes; `ok` is false on any HTTP or API error. */
export async function postJson(url: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<AuthResponse>;
  return { ...json, ok: res.ok && !!json.ok };
}

/** After a login: back to where the player came from, via the profile if it's unfinished. */
export function afterLogin(
  router: { replace(href: string): void; refresh(): void },
  returnTo: string | null,
  needsProfile?: boolean,
) {
  const target = safeReturnTo(returnTo);
  router.replace(needsProfile ? `/profile?returnTo=${encodeURIComponent(target)}` : target);
  router.refresh();
}
