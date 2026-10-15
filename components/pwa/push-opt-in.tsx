"use client";

import { useEffect, useState } from "react";
import { BellRingIcon } from "lucide-react";
import { disablePushAction, savePushSubscriptionAction } from "@/app/(site)/notifications/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { pushSupported, subscribeToPush } from "./push-subscribe";

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
    const ok = pushSupported(vapidPublicKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser capabilities once after mount
    setSupport(!ok ? "unsupported" : Notification.permission === "denied" ? "denied" : "ready");
  }, [vapidPublicKey]);

  if (support === "unknown") return null;

  async function subscribe() {
    const r = await subscribeToPush(vapidPublicKey!);
    if (!r.ok) {
      setSupport(r.permission === "denied" ? "denied" : "ready");
      return;
    }
    await enable.run({ endpoint: r.endpoint, keys: r.keys });
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
            ? "This browser can't show push notifications. Your inbox works everywhere."
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
