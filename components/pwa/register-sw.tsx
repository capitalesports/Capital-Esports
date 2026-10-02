"use client";

import { useEffect } from "react";
import { afterLoad } from "@/components/common/after-load";

/** Registers the service worker in production builds (push + offline page). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // Registered well after load (web.dev guidance) so the worker's install fetches never compete with the
    // page; it is only needed later (offline page, push).
    return afterLoad(
      () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}),
      { delayMs: 4000 },
    );
  }, []);
  return null;
}
