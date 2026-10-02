"use client";

import { adminRemoveTeamMemberAction, adminTransferCaptainAction } from "@/app/admin/teams/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

export function TeamMemberActions({
  teamId,
  userId,
  isCaptain,
  confirmed,
}: {
  teamId: string;
  userId: string;
  isCaptain: boolean;
  confirmed: boolean;
}) {
  const remove = useAction(adminRemoveTeamMemberAction);
  const transfer = useAction(adminTransferCaptainAction);
  if (isCaptain) return <span className="text-muted-foreground text-xs">Captain</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {confirmed ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={transfer.pending}
          onClick={() => transfer.run({ teamId, userId })}
        >
          Make captain
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        disabled={remove.pending}
        onClick={() => {
          if (confirm("Remove this player from the team?")) void remove.run({ teamId, userId });
        }}
      >
        Remove
      </Button>
    </div>
  );
}
