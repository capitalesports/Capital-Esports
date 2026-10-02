"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { useRouter } from "next/navigation";
import { markAllReadAction, markReadAction } from "@/app/(site)/notifications/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  when: string;
}

export function InboxList({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const markOne = useAction(markReadAction);
  const markAll = useAction(markAllReadAction);
  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="space-y-3">
      {unread ? (
        <Button variant="outline" disabled={markAll.pending} onClick={() => markAll.run()}>
          Mark all as read
        </Button>
      ) : null}
      <ul className="space-y-2" aria-label="Notifications">
        {items.map((n) => (
          <li key={n.id}>
            <Link
              href={n.url ?? "/dashboard"}
              onClick={(e) => {
                if (n.read) return;
                e.preventDefault();
                void markOne.run({ id: n.id }).then(() => router.push(n.url ?? "/dashboard"));
              }}
              className={cn(
                "hover:bg-accent block rounded-xl border p-4",
                n.read ? "border-border" : "border-primary/50 bg-primary/5",
              )}
            >
              <p className="flex items-center gap-2 font-semibold">
                {!n.read ? (
                  <span className="bg-primary size-2 rounded-full" aria-label="Unread" />
                ) : null}
                {n.title}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">{n.body}</p>
              <p className="text-muted-foreground mt-1 text-xs">{n.when}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
