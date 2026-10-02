"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccountAction } from "@/app/(site)/profile/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONFIRM_WORD = "DELETE";

/** Account deletion behind a dialog that needs the word DELETE typed in. */
export function DeleteAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { run, pending, fieldErrors } = useAction(deleteAccountAction);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your name, avatar, date of birth, game IDs and team memberships are removed and your
            upcoming registrations are cancelled (paid entries are refunded). This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await run({ confirm });
            if (result.ok) {
              setOpen(false);
              router.replace("/");
              router.refresh();
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">Type {CONFIRM_WORD} to confirm</Label>
            <Input
              id="delete-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              aria-invalid={!!fieldErrors.confirm}
              aria-describedby="delete-confirm-error"
            />
            <FieldError id="delete-confirm-error" messages={fieldErrors.confirm} />
          </div>
          <Button
            type="submit"
            variant="destructive"
            className="w-full"
            disabled={pending || confirm !== CONFIRM_WORD}
          >
            {pending ? "Deleting…" : "Delete my account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
