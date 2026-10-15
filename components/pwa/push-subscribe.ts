/** Browser push helpers shared by the dashboard card and the site-wide prompt (DECISIONS M64). */

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Push works in this browser (iPhone: only for a site added to the home screen). */
export function pushSupported(vapidPublicKey: string | null): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!vapidPublicKey
  );
}

/**
 * Ask for permission (must run from a click) and subscribe this device. Returns the subscription
 * to save, or the permission the player chose instead.
 */
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<
  | { ok: true; endpoint: string; keys: { p256dh: string; auth: string } }
  | { ok: false; permission: NotificationPermission }
> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, permission };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return { ok: true, endpoint: json.endpoint, keys: json.keys };
}
