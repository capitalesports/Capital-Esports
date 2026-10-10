"use client";

import { useRouter } from "next/navigation";
import { leaveRosterAction } from "@/app/(site)/scrims/[id]/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

/** Take myself off a team roster a captain entered me in (before the match starts). */
export function LeaveRosterButton({ matchId, teamName }: { matchId: string; teamName: string }) {
  const router = useRouter();
  const { run, pending } = useAction(leaveRosterAction);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!confirm(`Leave ${teamName}'s roster for this match?`)) return;
        const r = await run({ matchId });
        if (r.ok) router.refresh();
      }}
    >
      {pending ? "Leaving…" : "Leave this roster"}
    </Button>
  );
}
