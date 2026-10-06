"use client";

import { useState } from "react";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearAllNotificationsAction, deleteAnnouncementAction } from "./actions";

/** Take one sent announcement out of every player's notifications. */
export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  const { run, pending } = useAction(deleteAnnouncementAction);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Delete “${title}” from every player's notifications`}
      onClick={() => {
        if (confirm(`Delete “${title}” from every player's notifications?`))
          void run({ announcementId: id });
      }}
    >
      Delete from all
    </Button>
  );
}

/** Empty every player's notification bell (all kinds). Needs the word CLEAR typed in. */
export function ClearAllNotifications() {
  const [confirmText, setConfirmText] = useState("");
  const { run, pending, fieldErrors } = useAction(clearAllNotificationsAction);
  return (
    <section aria-labelledby="clear-all-h" className="card-ds mt-10 space-y-3 p-4">
      <h2 id="clear-all-h" className="text-lg font-semibold">
        Clear every player&apos;s notifications
      </h2>
      <p className="text-muted-foreground text-sm">
        Deletes all notifications (announcements, slot confirmations, reminders, everything) from
        every player&apos;s bell. This cannot be undone.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run({ confirm: confirmText });
          if (r.ok) setConfirmText("");
        }}
      >
        <div className="min-w-48">
          <FormField id="clear-confirm" label="Type CLEAR to confirm" errors={fieldErrors.confirm}>
            <Input
              id="clear-confirm"
              value={confirmText}
              autoComplete="off"
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </FormField>
        </div>
        <Button type="submit" variant="destructive" disabled={pending || confirmText !== "CLEAR"}>
          Clear all notifications
        </Button>
      </form>
    </section>
  );
}
