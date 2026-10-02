"use client";

import { useState } from "react";
import {
  approveDeletionRequestAction,
  rejectDeletionRequestAction,
} from "@/app/admin/deletion-requests/actions";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELETION_NOTE_MAX } from "@/lib/input-rules";

/** Approve (erase the account) or decline a deletion request, with an optional note. */
export function DeletionRequestActions({ requestId, name }: { requestId: string; name: string }) {
  const [note, setNote] = useState("");
  const approve = useAction(approveDeletionRequestAction);
  const reject = useAction(rejectDeletionRequestAction);
  const busy = approve.pending || reject.pending;
  const noteId = `note-${requestId}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={noteId} className="text-xs">
        Note to the player (optional, shown if declined)
      </Label>
      <Input
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={DELETION_NOTE_MAX}
        aria-describedby={`${noteId}-error`}
      />
      <FieldError
        id={`${noteId}-error`}
        messages={approve.fieldErrors.note ?? reject.fieldErrors.note}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete ${name}'s account? This cannot be undone.`)) {
              void approve.run({ requestId, note });
            }
          }}
        >
          {approve.pending ? "Deleting…" : "Approve and delete"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => reject.run({ requestId, note })}
        >
          {reject.pending ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
