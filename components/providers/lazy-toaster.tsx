"use client";

import dynamic from "next/dynamic";

// Toasts only follow user actions, so the toaster loads after hydration instead of on the first-paint path.
const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

export function LazyToaster() {
  return <Toaster richColors position="top-center" />;
}
