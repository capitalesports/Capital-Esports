"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * `<Link>` that prefetches on intent (hover, touch or keyboard focus) instead of on entering the
 * viewport (Next docs: "Hover-triggered prefetch"). Use it for links rendered in bulk (card grids,
 * chips) or visible on load, so a page doesn't fire a prefetch request per link during its first paint.
 */
export function IntentLink({
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...props
}: React.ComponentProps<typeof Link>) {
  const [active, setActive] = useState(false);
  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(e) => {
        setActive(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setActive(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setActive(true);
        onFocus?.(e);
      }}
    />
  );
}
