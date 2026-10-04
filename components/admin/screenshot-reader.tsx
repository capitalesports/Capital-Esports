"use client";

import { useState } from "react";
import { ImagePlusIcon, ScanTextIcon } from "lucide-react";
import { readResultScreenshotsAction } from "@/app/admin/results/actions";
import { useAction } from "@/components/common/use-action";
import { Button, buttonVariants } from "@/components/ui/button";
import type { MatchOutcome } from "@/lib/result-matching";
import { cn } from "@/lib/utils";

export type ReadOutcome = MatchOutcome & { rowsRead: number };

/**
 * Upload end-of-match screenshots; AI reads rank and kills (or the winner) and the results form
 * fills itself. The admin checks the highlighted rows, edits anything wrong and approves (M48).
 */
export function ScreenshotReader({
  matchId,
  onRead,
}: {
  matchId: string;
  onRead: (outcome: ReadOutcome) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const read = useAction(readResultScreenshotsAction);

  return (
    <section aria-labelledby="shot-reader-h" className="card-ds border-gold/40 space-y-3 p-4">
      <h2 id="shot-reader-h" className="flex items-center gap-2 font-semibold">
        <ScanTextIcon aria-hidden className="text-gold size-5" />
        Fill from screenshots
      </h2>
      <p className="text-muted-foreground text-sm">
        Upload the result screen (up to 4 screenshots if the list scrolls). Rank and kills, or the
        winner, are read automatically. Check the highlighted players, fix anything wrong, then
        approve.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("matchId", matchId);
          const r = await read.run(form);
          if (r.ok) onRead(r.data);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* The native file picker is hidden; this label is the visible "button" that opens it. */}
          <label
            htmlFor="result-shots"
            className={cn(
              buttonVariants({ variant: "gold-outline" }),
              "cursor-pointer focus-within:ring-2",
            )}
          >
            <ImagePlusIcon aria-hidden className="size-4" />
            Choose screenshots
            <input
              id="result-shots"
              name="screenshots"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => f.name))}
            />
          </label>
          <Button type="submit" disabled={read.pending || files.length === 0}>
            {read.pending ? "Reading…" : "Read screenshots"}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {files.length
            ? `${files.length} chosen: ${files.join(", ")}`
            : "No screenshots chosen yet."}
        </p>
      </form>
    </section>
  );
}
