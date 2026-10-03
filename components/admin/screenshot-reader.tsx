"use client";

import { useRef, useState } from "react";
import { ScanTextIcon } from "lucide-react";
import { readResultScreenshotsAction } from "@/app/admin/results/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MatchOutcome } from "@/lib/result-matching";

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
  const input = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
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
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("matchId", matchId);
          const r = await read.run(form);
          if (r.ok) onRead(r.data);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="result-shots">Screenshots</Label>
          <input
            ref={input}
            id="result-shots"
            name="screenshots"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => setCount(e.target.files?.length ?? 0)}
            className="min-h-tap text-sm"
          />
        </div>
        <Button type="submit" disabled={read.pending || count === 0}>
          {read.pending ? "Reading…" : "Read screenshots"}
        </Button>
      </form>
    </section>
  );
}
