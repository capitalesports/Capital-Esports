import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { InboxList } from "@/components/notifications/inbox-list";
import { Button } from "@/components/ui/button";
import { requirePageUser } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listMyNotifications } from "@/server/services/inbox";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requirePageUser("/notifications");
  const page = Number((await searchParams).page ?? 1) || 1;
  const { rows, pages } = await listMyNotifications(toActor(user), page);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        description="Match reminders, confirmations, results and payouts."
      />
      {rows.length === 0 ? (
        <EmptyState
          art="empty-no-notifications"
          title="No notifications yet"
          description="Register for a match and we'll keep you posted here."
          action={{ href: "/scrims", label: "Browse scrims" }}
        />
      ) : (
        <InboxList
          items={rows.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            url: n.url,
            read: !!n.readAt,
            when: formatIST(n.createdAt),
          }))}
        />
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex gap-2">
          {page > 1 ? (
            <Button asChild variant="outline">
              <Link href={`/notifications?page=${page - 1}`}>Newer</Link>
            </Button>
          ) : null}
          {page < pages ? (
            <Button asChild variant="outline">
              <Link href={`/notifications?page=${page + 1}`}>Older</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
