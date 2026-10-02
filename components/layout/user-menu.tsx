"use client";

import { useState } from "react";
import { IntentLink as Link } from "@/components/common/intent-link";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { PlayerAvatar } from "@/components/common/player-avatar";
import { cn } from "@/lib/utils";
import { useDisclosure } from "./use-disclosure";

export type HeaderRole = "PLAYER" | "MODERATOR" | "ADMIN";

const ROLE_LABEL: Record<HeaderRole, string> = {
  PLAYER: "Player",
  MODERATOR: "Moderator",
  ADMIN: "Admin",
};

const itemClass =
  "flex min-h-tap w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-background hover:text-gold";

/** Navbar account menu (scrims-desktop.png): avatar, display name and role, with Dashboard / Profile / Teams / Logout. */
export function UserMenu({
  name,
  avatarUrl,
  role,
}: {
  name: string;
  avatarUrl: string | null;
  role: HeaderRole;
}) {
  const { open, setOpen, rootProps, buttonProps, panelProps } = useDisclosure();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const links: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
    { href: "/profile", label: "Profile", icon: UserIcon },
    { href: "/teams", label: "Teams", icon: UsersIcon },
    ...(role === "PLAYER" ? [] : [{ href: "/admin", label: "Admin panel", icon: ShieldIcon }]),
  ];

  return (
    <div {...rootProps} className="relative">
      <button
        {...buttonProps}
        aria-label={`Account menu: ${name}`}
        className="min-h-tap hover:text-gold flex items-center gap-2 rounded-lg px-1.5"
      >
        <PlayerAvatar name={name} src={avatarUrl} size={36} />
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className="block max-w-28 truncate text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground block text-xs">{ROLE_LABEL[role]}</span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("hidden size-4 transition-transform sm:block", open && "rotate-180")}
        />
      </button>
      <ul
        {...panelProps}
        className="card-ds absolute top-full right-0 z-50 mt-1 min-w-48 p-1 shadow-lg"
      >
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} onClick={() => setOpen(false)} className={itemClass}>
              <l.icon aria-hidden className="text-muted-foreground size-4" />
              {l.label}
            </Link>
          </li>
        ))}
        <li className="border-border mt-1 border-t pt-1">
          <button
            type="button"
            disabled={leaving}
            className={itemClass}
            onClick={async () => {
              setLeaving(true);
              await fetch("/api/auth/logout", { method: "POST" });
              setOpen(false);
              router.replace("/");
              router.refresh();
            }}
          >
            <LogOutIcon aria-hidden className="text-muted-foreground size-4" />
            {leaving ? "Logging out…" : "Logout"}
          </button>
        </li>
      </ul>
    </div>
  );
}
