"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { afterLoad } from "@/components/common/after-load";

function send(path: string) {
  const body = JSON.stringify({ path });
  if (navigator.sendBeacon)
    navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
  else
    void fetch("/api/analytics", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    });
}

/**
 * Sends a cookie-less page-view beacon on every route change (first-party analytics). It waits until
 * the page has loaded and settled so it never competes with the first paint, and flushes immediately
 * if the tab is hidden or closed before then.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    let sent = false;
    const flush = () => {
      if (sent) return;
      sent = true;
      send(pathname);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    const cancel = afterLoad(flush, { delayMs: 2000 });
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [pathname]);
  return null;
}
