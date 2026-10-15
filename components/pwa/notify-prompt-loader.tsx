"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { afterLoad } from "@/components/common/after-load";

const NotifyPrompt = dynamic(() => import("./notify-prompt").then((m) => m.NotifyPrompt), {
  ssr: false,
});

/** Loads the notifications bar only after the page has loaded (first-paint budget). */
export function NotifyPromptLoader({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [ready, setReady] = useState(false);
  useEffect(() => afterLoad(() => setReady(true), { delayMs: 3000 }), []);
  return ready ? <NotifyPrompt vapidPublicKey={vapidPublicKey} /> : null;
}
