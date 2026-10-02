"use client";

import { useState } from "react";
import { FlagIcon } from "lucide-react";
import { createReportAction } from "@/app/(site)/players/[id]/actions";
import { FormField } from "@/components/common/form-field";
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
import { Textarea } from "@/components/ui/textarea";

export function ReportDialog({
  type,
  targetUserId,
  matchId,
  label,
}: {
  type: "PLAYER" | "RESULT" | "DISPUTE";
  targetUserId?: string;
  matchId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const { run, pending, fieldErrors } = useAction(createReportAction);
  const title =
    type === "DISPUTE"
      ? "Dispute these results"
      : type === "RESULT"
        ? "Report this result"
        : "Report this player";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FlagIcon aria-hidden /> {label ?? (type === "DISPUTE" ? "Dispute results" : "Report")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {type === "DISPUTE"
              ? "Disputes can be opened within 2 hours of results. A moderator reviews and may correct the points."
              : "A moderator reviews every report. False reports can lead to a ban."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({
              type,
              targetUserId,
              matchId,
              reason,
              evidenceUrl: evidenceUrl || undefined,
            });
            if (r.ok) {
              setOpen(false);
              setReason("");
              setEvidenceUrl("");
            }
          }}
        >
          <FormField id="report-reason" label="What happened?" errors={fieldErrors.reason}>
            <Textarea
              id="report-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <FormField
            id="report-evidence"
            label="Evidence link (optional)"
            help="Video, screenshot or clip URL"
            errors={fieldErrors.evidenceUrl}
          >
            <Input
              id="report-evidence"
              type="url"
              placeholder="https://"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            Send
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
