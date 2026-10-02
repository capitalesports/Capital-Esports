"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * WAI "disclosure" behaviour for header menus: a button toggles a panel that closes on Escape
 * (returning focus to the button), on outside click, when focus leaves, and after navigating.
 */
export function useDisclosure() {
  const pathname = usePathname();
  // Open state is tied to the path it was opened on, so navigating closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean) => setOpenAt(value ? pathname : null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenAt(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return {
    open,
    setOpen,
    pathname,
    rootProps: {
      ref: rootRef,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      },
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      },
    },
    buttonProps: {
      ref: buttonRef,
      type: "button" as const,
      "aria-expanded": open,
      "aria-controls": panelId,
      onClick: () => setOpen(!open),
    },
    panelProps: { id: panelId, hidden: !open },
  };
}
