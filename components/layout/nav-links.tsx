"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { GAME_LIST } from "@/lib/games";
import { isActivePath, MAIN_NAV, MORE_NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useDisclosure } from "./use-disclosure";

const linkClass = (active: boolean) =>
  cn(
    "relative inline-flex min-h-tap items-center px-3 text-sm font-medium transition-colors hover:text-gold",
    active
      ? "text-gold after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded after:bg-gold"
      : "text-foreground",
  );

/** Games / More: a navigation disclosure (see `useDisclosure`), no popper library. */
function Dropdown({ label, items, active }: { label: string; items: NavItem[]; active: boolean }) {
  const { open, setOpen, pathname, rootProps, buttonProps, panelProps } = useDisclosure();
  return (
    <div {...rootProps} className="relative">
      <button {...buttonProps} className={cn(linkClass(active), "gap-1")}>
        {label}
        <ChevronDownIcon
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      <ul
        {...panelProps}
        className="card-ds absolute top-full left-0 z-50 mt-1 min-w-48 p-1 shadow-lg"
      >
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={isActivePath(pathname, i.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              className="min-h-tap hover:bg-background hover:text-gold aria-[current=page]:text-gold flex items-center rounded-md px-3 text-sm transition-colors"
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Desktop navbar links: Home, Scrims, Tournament, Leaderboard, Games ▾, More ▾. */
export function NavLinks() {
  const pathname = usePathname();
  const games = GAME_LIST.map((g) => ({ href: `/games/${g.slug}`, label: g.name }));
  return (
    <ul className="flex items-center">
      {MAIN_NAV.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={linkClass(active)}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
      <li>
        <Dropdown label="Games" items={games} active={pathname.startsWith("/games/")} />
      </li>
      <li>
        <Dropdown
          label="More"
          items={MORE_NAV}
          active={MORE_NAV.some((m) => isActivePath(pathname, m.href))}
        />
      </li>
    </ul>
  );
}
