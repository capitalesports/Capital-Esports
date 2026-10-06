import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listAnnouncements } from "@/server/services/announcements";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { formatIST } from "@/lib/time";
import { AnnouncementForm } from "./announcement-form";
import { ClearAllNotifications, DeleteAnnouncementButton } from "./delete-controls";

export const metadata: Metadata = { title: "Announcements" };

function audienceLabel(a: string) {
  return a in GAME_CONFIG ? `${GAME_CONFIG[a as Game].name} players` : "All players";
}

export default async function AdminAnnouncementsPage() {
  const user = await requireStaffPage("/admin/announcements");
  const sent = await listAnnouncements(toActor(user));
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Send a message to every player's notifications (and as a push to players who turned push on), or take it back."
      />
      <AnnouncementForm />
      <section aria-labelledby="sent-h" className="mt-10 space-y-3">
        <h2 id="sent-h" className="text-lg font-semibold">
          Recently sent
        </h2>
        {sent.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {sent.map((a) => (
              <li key={a.id} className="card-ds space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{a.title}</p>
                  {a.deleted ? (
                    <span className="text-muted-foreground text-xs">Deleted from all</span>
                  ) : (
                    <DeleteAnnouncementButton id={a.id} title={a.title} />
                  )}
                </div>
                <p className="text-muted-foreground">{a.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatIST(a.sentAt)} · {audienceLabel(a.audience)} · {a.recipients} recipients ·
                  by {a.by}
                  {a.link ? ` · ${a.link}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ClearAllNotifications />
    </>
  );
}
