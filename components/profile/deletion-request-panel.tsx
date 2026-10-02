"use client";

import { useState } from "react";
import {
  cancelAccountDeletionRequestAction,
  requestAccountDeletionAction,
} from "@/app/(site)/profile/actions";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DELETION_REASON_MAX } from "@/lib/input-rules";

/**
 * Players can't delete their account directly: they send a request and an admin approves it
 * (DECISIONS M39). Shows the pending request with a way to withdraw it.
 */
export function DeletionRequestPanel({ requestedAt }: { requestedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const send = useAction(requestAccountDeletionAction);
  const cancel = useAction(cancelAccountDeletionRequestAction);

  if (requestedAt) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          You asked to delete your account on <span className="font-medium">{requestedAt}</span>. An
          admin will review it; until then your account works as usual.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={cancel.pending}
          onClick={() => cancel.run()}
        >
          {cancel.pending ? "Cancelling…" : "Cancel deletion request"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Send a request and an admin will delete your account. Your name, avatar, date of birth, game
        IDs and team memberships are removed and upcoming registrations are cancelled (paid entries
        are refunded). This cannot be undone.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">Request account deletion</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request account deletion?</DialogTitle>
            <DialogDescription>
              An admin reviews every request. Team captains must hand over captaincy first, and a
              prize being paid out must finish first.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await send.run({ reason });
              if (result.ok) {
                setOpen(false);
                setReason("");
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="deletion-reason">Reason (optional)</Label>
              <Textarea
                id="deletion-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={DELETION_REASON_MAX}
                rows={3}
                aria-invalid={!!send.fieldErrors.reason}
                aria-describedby="deletion-reason-error"
              />
              <FieldError id="deletion-reason-error" messages={send.fieldErrors.reason} />
            </div>
            <Button type="submit" variant="destructive" className="w-full" disabled={send.pending}>
              {send.pending ? "Sending…" : "Send deletion request"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
