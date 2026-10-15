"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRingIcon, XIcon } from "lucide-react";
import { savePushSubscriptionAction } from "@/app/(site)/notifications/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { pushSupported, subscribeToPush } from "./push-subscribe";

const DISMISS_KEY = "notify-prompt-dismissed-at";
const DISMISS_DAYS = 3;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * Site-wide bar for logged-in players without notifications (DECISIONS M64): new scrims and
 * tournaments, slot confirmations and the 30-minute reminder. The browser's own permission
 * dialog only opens from the "Allow" click; "Not now" hides it for 3 days.
 */
export function NotifyPrompt({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const enable = useAction(savePushSubscriptionAction);

  useEffect(() => {
    // Automated browsers (the e2e tests) never get it: it would cover buttons mid-test.
    const ok =
      !navigator.webdriver &&
      pushSupported(vapidPublicKey) &&
      Notification.permission !== "denied" &&
      !dismissedRecently();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser state once after mount
    setShow(ok);
  }, [vapidPublicKey]);

  if (!show) return null;

  function notNow() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setShow(false);
  }

  async function allow() {
    setBusy(true);
    try {
      const r = await subscribeToPush(vapidPublicKey!);
      if (!r.ok) {
        if (r.permission === "denied") setShow(false);
        else notNow();
        return;
      }
      const saved = await enable.run({ endpoint: r.endpoint, keys: r.keys });
      if (saved.ok) {
        setShow(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Turn on notifications"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:right-4 sm:bottom-4 sm:left-auto sm:max-w-md"
    >
      <div className="card-ds border-gold/60 flex items-start gap-3 p-4 shadow-lg">
        <BellRingIcon aria-hidden className="text-gold mt-0.5 size-6 shrink-0" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm">
            <span className="font-semibold">Turn on notifications</span>
            <span className="text-muted-foreground">
              {" "}
              for new scrims and tournaments, slot confirmations and a reminder 30 minutes before
              your match.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void allow()}>
              Allow notifications
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={notNow}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={notNow}
          className="text-muted-foreground hover:text-foreground min-h-tap min-w-tap -m-2 inline-flex items-center justify-center"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
