"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** "Install the app" card, shown on the dashboard only after the player's first registration. */
export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!event || done) return null;
  return (
    <section
      aria-label="Install the app"
      className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-3 rounded-xl border p-4"
    >
      <DownloadIcon aria-hidden className="text-primary size-6" />
      <p className="min-w-0 flex-1 text-sm">
        Install the app for one-tap access to your matches and room IDs.
      </p>
      <Button
        onClick={async () => {
          await event.prompt();
          await event.userChoice;
          setDone(true);
        }}
      >
        Install
      </Button>
    </section>
  );
}
