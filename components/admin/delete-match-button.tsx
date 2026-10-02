"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { deleteMatchAction } from "@/app/admin/matches/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

/**
 * Admin-only delete. Two steps (Delete → Delete permanently) so a stray tap can't remove anything.
 * A match with players loses their registrations, results and points too (DECISIONS M25); the
 * server refuses matches with paid entry fees or a prize payout already under way.
 */
export function DeleteMatchButton({
  matchId,
  title,
  registrations = 0,
  played = false,
  redirectTo,
}: {
  matchId: string;
  title: string;
  /** Registrations that go with it (shown in the confirmation). */
  registrations?: number;
  /** Results pending or completed: results and leaderboard points are removed too. */
  played?: boolean;
  /** Where to go after deleting (e.g. from the match page back to the list); otherwise refresh. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { run, pending } = useAction(deleteMatchAction);

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
        <Trash2Icon aria-hidden /> Delete
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Delete ${title}?`} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">
        Delete “{title}” for good?
        {registrations > 0
          ? ` Its ${registrations} registration${registrations === 1 ? "" : "s"}${played ? ", results and leaderboard points" : ""} will be removed too.`
          : ""}
      </span>
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={async () => {
          const r = await run({ matchId });
          if (!r.ok) return setConfirming(false);
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
        }}
      >
        {pending ? "Deleting…" : "Delete permanently"}
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </div>
  );
}
