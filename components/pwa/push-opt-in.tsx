"use client";

import { useEffect, useState } from "react";
import { BellRingIcon } from "lucide-react";
import { disablePushAction, savePushSubscriptionAction } from "@/app/(site)/notifications/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Support = "unknown" | "unsupported" | "denied" | "ready";

/** Dashboard card: opt in to push for reminders and room IDs. Never shown on first visit. */
export function PushOptIn({
  vapidPublicKey,
  optedIn,
}: {
  vapidPublicKey: string | null;
  optedIn: boolean;
}) {
  const [support, setSupport] = useState<Support>("unknown");
  const enable = useAction(savePushSubscriptionAction);
  const disable = useAction(disablePushAction);

  useEffect(() => {
    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      !!vapidPublicKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser capabilities once after mount
    setSupport(!ok ? "unsupported" : Notification.permission === "denied" ? "denied" : "ready");
  }, [vapidPublicKey]);

  if (support === "unknown") return null;

  async function subscribe() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setSupport(permission === "denied" ? "denied" : "ready");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
    });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await enable.run({ endpoint: json.endpoint, keys: json.keys });
  }

  return (
    <section aria-labelledby="push-h" className="card-ds flex flex-wrap items-center gap-3 p-4">
      <BellRingIcon aria-hidden className="text-primary size-6" />
      <div className="min-w-0 flex-1">
        <h2 id="push-h" className="font-semibold">
          Match reminders on this phone
        </h2>
        <p className="text-muted-foreground text-sm">
          {support === "unsupported"
            ? "Install the app to your home screen to get push notifications. Your inbox works everywhere."
            : support === "denied"
              ? "Notifications are blocked in your browser settings. Your inbox still works."
              : optedIn
                ? "Push is on. You'll get reminders 30 minutes before matches and when room IDs are ready."
                : "Get a push 30 minutes before your match and when the room ID is ready."}
        </p>
      </div>
      {support === "ready" ? (
        optedIn ? (
          <Button variant="outline" disabled={disable.pending} onClick={() => disable.run()}>
            Turn off
          </Button>
        ) : (
          <Button disabled={enable.pending} onClick={() => void subscribe()}>
            Enable notifications
          </Button>
        )
      ) : null}
    </section>
  );
}
