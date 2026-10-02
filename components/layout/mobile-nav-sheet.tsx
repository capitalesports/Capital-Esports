"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GAME_LIST } from "@/lib/games";
import { FOOTER_NAV, isActivePath, MAIN_NAV, MORE_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

function Group({
  title,
  items,
  close,
  pathname,
}: {
  title?: string;
  items: { href: string; label: string }[];
  close: () => void;
  pathname: string;
}) {
  return (
    <div className="border-border border-t pt-3 first:border-0 first:pt-0">
      {title ? (
        <p className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
          {title}
        </p>
      ) : null}
      <ul>
        {items.map((i) => {
          const active = isActivePath(pathname, i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "min-h-tap hover:text-gold flex items-center rounded-md px-3 text-sm font-medium",
                  active ? "text-gold" : "text-foreground",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The mobile menu sheet (Radix Dialog); loaded on first tap of the menu button so it stays off the first-paint path. */
export default function MobileNavSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="border-border bg-background overflow-y-auto p-4">
        <SheetTitle className="font-heading text-xl">Menu</SheetTitle>
        <nav aria-label="Mobile" className="space-y-3">
          <Group items={MAIN_NAV} close={close} pathname={pathname} />
          <Group
            title="Games"
            items={GAME_LIST.map((g) => ({ href: `/games/${g.slug}`, label: g.name }))}
            close={close}
            pathname={pathname}
          />
          <Group
            title="More"
            items={[
              ...MORE_NAV,
              ...FOOTER_NAV.filter((f) => !MORE_NAV.some((m) => m.href === f.href)),
            ]}
            close={close}
            pathname={pathname}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
