"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { usePathname } from "next/navigation";
import type { AdminSection } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

export function AdminNav({ sections }: { sections: Pick<AdminSection, "href" | "label">[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {sections.map((s) => {
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "min-h-tap flex items-center rounded-md px-3 text-sm font-medium",
                  active
                    ? "border-gold bg-surface text-gold border-l-2"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
