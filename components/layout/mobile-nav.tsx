"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const MobileNavSheet = dynamic(() => import("./mobile-nav-sheet"), { ssr: false });

/** Mobile menu button: the same items as the desktop navbar, stacked, plus search and the footer links. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        // Start fetching the sheet as soon as the user reaches for the button.
        onPointerEnter={() => setLoaded(true)}
        onFocus={() => setLoaded(true)}
      >
        <MenuIcon aria-hidden />
      </Button>
      {loaded ? <MobileNavSheet open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
