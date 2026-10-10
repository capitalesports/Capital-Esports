"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { deleteTournamentAction } from "@/app/admin/tournaments/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

/**
 * Admin: delete a tournament for good (DECISIONS M59). Two steps so a stray tap can't remove it;
 * the server refuses tournaments where entry fees were paid (cancel those instead).
 */
export function DeleteTournamentButton({
  tournamentId,
  title,
  registrations,
}: {
  tournamentId: string;
  title: string;
  registrations: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { run, pending } = useAction(deleteTournamentAction);

  return (
    <section aria-labelledby="del-t-h" className="card-ds border-destructive/40 space-y-3 p-4">
      <h2 id="del-t-h" className="font-semibold">
        Delete tournament
      </h2>
      <p className="text-muted-foreground text-sm">
        Removes the tournament, its matches, sign-ups, results and points for good. A tournament
        where players paid an entry fee can&apos;t be deleted: cancel it instead so they are
        refunded.
      </p>
      {!confirming ? (
        <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
          <Trash2Icon aria-hidden /> Delete tournament
        </Button>
      ) : (
        <div
          role="group"
          aria-label={`Delete ${title}?`}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm">
            Delete “{title}” for good?
            {registrations > 0
              ? ` Its ${registrations} sign-up${registrations === 1 ? "" : "s"} will be removed too.`
              : ""}
          </span>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              const r = await run({ tournamentId });
              if (!r.ok) return setConfirming(false);
              router.push("/admin/tournaments");
            }}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </div>
      )}
    </section>
  );
}
