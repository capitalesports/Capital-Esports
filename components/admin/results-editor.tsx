"use client";

import { useMemo, useState } from "react";
import {
  approveResultsAction,
  reopenResultsAction,
  saveResultRowsAction,
} from "@/app/admin/results/actions";
import { ScreenshotReader, type ReadOutcome } from "@/components/admin/screenshot-reader";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isHeadToHead, type MatchMode } from "@/lib/match-modes";
import { duplicatePlacements, entriesPerPlacement } from "@/lib/points";
import { cn } from "@/lib/utils";

export interface EditorEntry {
  registrationId: string;
  name: string;
  status: string;
  screenshotUrl: string | null;
  trackerUrl: string | null;
  submitted: boolean;
  placement: number | null;
  kills: number | null;
  won: boolean | null;
  roundDiff: number | null;
}

interface Row {
  registrationId: string;
  absent: boolean;
  placement: string;
  kills: string;
  won: boolean;
  roundDiff: string;
}

export function ResultsEditor({
  matchId,
  status,
  mode,
  entries,
  canReopen,
  reopenBlockedReason,
}: {
  matchId: string;
  status: string;
  mode: MatchMode;
  entries: EditorEntry[];
  canReopen: boolean;
  /** Shown instead of the reopen button when reopening is not allowed for this user. */
  reopenBlockedReason?: string;
}) {
  const battleRoyale = !isHeadToHead(mode);
  const editable = status === "RESULTS_PENDING";
  const [rows, setRows] = useState<Row[]>(
    entries.map((e) => ({
      registrationId: e.registrationId,
      // Nobody starts ticked: only a no-show the admin already saved stays ticked.
      absent: e.status === "NO_SHOW",
      placement: e.placement?.toString() ?? "",
      kills: e.kills?.toString() ?? "",
      won: !!e.won,
      roundDiff: e.roundDiff?.toString() ?? "0",
    })),
  );
  const [reason, setReason] = useState("");
  // After a screenshot read: how each entry was filled, and names that matched nobody (M48).
  const [hints, setHints] = useState<Map<string, { exact: boolean; readNames: string[] }> | null>(
    null,
  );
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const applyRead = (outcome: ReadOutcome) => {
    const byId = new Map(outcome.suggestions.map((sg) => [sg.registrationId, sg]));
    const anyWinner = outcome.suggestions.some((sg) => sg.won === true);
    setRows((rs) =>
      rs.map((r) => {
        const sg = byId.get(r.registrationId);
        if (!sg) return battleRoyale || !anyWinner ? r : { ...r, won: false };
        return {
          ...r,
          absent: false,
          placement: sg.placement !== null ? String(sg.placement) : r.placement,
          kills: sg.kills !== null ? String(sg.kills) : r.kills,
          won: sg.won ?? r.won,
        };
      }),
    );
    setHints(
      new Map(
        outcome.suggestions.map((sg) => [
          sg.registrationId,
          { exact: sg.confidence === "exact", readNames: sg.readNames },
        ]),
      ),
    );
    setUnmatched(outcome.unmatched);
  };
  const save = useAction(saveResultRowsAction);
  const approve = useAction(approveResultsAction);
  const reopen = useAction(reopenResultsAction);
  const perPlacement = entriesPerPlacement(mode);
  const conflicts = useMemo(
    () =>
      battleRoyale
        ? duplicatePlacements(
            rows.filter((r) => !r.absent).map((r) => (r.placement ? Number(r.placement) : null)),
            perPlacement,
          )
        : [],
    [rows, battleRoyale, perPlacement],
  );
  const present = rows.filter((r) => !r.absent);
  const winners = present.filter((r) => r.won).length;
  const walkover =
    !battleRoyale && present.length === 1
      ? entries.find((e) => e.registrationId === present[0]!.registrationId)
      : undefined;
  const nobodyPlayed = !battleRoyale && present.length === 0;
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setAbsent = (i: number, absent: boolean) =>
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, absent, won: absent ? false : r.won } : r));
      const left = next.filter((r) => !r.absent);
      // Head-to-head walkover: the only side that showed up wins.
      if (!battleRoyale && left.length === 1) return next.map((r) => ({ ...r, won: !r.absent }));
      return next;
    });

  const payload = () => ({
    matchId,
    rows: rows.map((r) =>
      r.absent
        ? { registrationId: r.registrationId, absent: true }
        : battleRoyale
          ? {
              registrationId: r.registrationId,
              placement: Number(r.placement),
              kills: Number(r.kills || 0),
            }
          : { registrationId: r.registrationId, won: r.won, roundDiff: Number(r.roundDiff || 0) },
    ),
  });

  return (
    <div className="space-y-4">
      {editable ? <ScreenshotReader matchId={matchId} onRead={applyRead} /> : null}
      {hints ? (
        <p role="status" className="bg-surface rounded-lg p-3 text-sm">
          Filled {hints.size} of {entries.length} from the screenshots. Check every highlighted
          player before approving.
          {unmatched.length ? (
            <>
              {" "}
              Names not matched to anyone:{" "}
              <span className="font-medium">{unmatched.join(", ")}</span>.
            </>
          ) : null}
        </p>
      ) : null}
      {conflicts.length ? (
        <p role="alert" className="bg-destructive/15 text-destructive rounded-lg p-3 text-sm">
          Placement conflict: {conflicts.join(", ")} claimed by more than{" "}
          {perPlacement === 1 ? "one entry" : `${perPlacement} entries (duo partners)`}.
        </p>
      ) : null}
      {editable && nobodyPlayed ? (
        <p role="alert" className="bg-warning/15 rounded-lg p-3 text-sm">
          No side played. Cancel the match instead of approving it.
        </p>
      ) : editable && walkover ? (
        <p role="status" className="bg-warning/15 rounded-lg p-3 text-sm">
          Walkover: only {walkover.name} showed up, so they are the winner. The other side gets a
          no-show.
        </p>
      ) : !battleRoyale && editable && winners !== 1 ? (
        <p role="alert" className="bg-warning/15 rounded-lg p-3 text-sm">
          Mark exactly one winner.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((e, i) => {
          const row = rows[i]!;
          const conflict = battleRoyale && !row.absent && conflicts.includes(Number(row.placement));
          const hint = hints?.get(e.registrationId);
          return (
            <article
              key={e.registrationId}
              aria-label={`Result for ${e.name}`}
              className={cn(
                "space-y-3 rounded-xl border p-3",
                conflict
                  ? "border-destructive"
                  : hints && (!hint || !hint.exact)
                    ? "border-gold"
                    : "border-border",
              )}
            >
              {hints ? (
                <p
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    hint?.exact ? "text-success bg-success/10" : "text-gold bg-gold/10",
                  )}
                >
                  {!hint
                    ? "Not found in the screenshots: fill in or tick no-show"
                    : hint.exact
                      ? "Filled from the screenshot"
                      : `Check: read as “${hint.readNames.join(", ")}”`}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{e.name}</h3>
                <span className="text-muted-foreground text-xs">
                  {e.submitted ? "Submitted" : "No submission"}
                  {e.status === "NO_SHOW" ? " · no-show" : ""}
                </span>
              </div>
              {e.screenshotUrl ? (
                <a
                  href={e.screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="border-border block overflow-hidden rounded-lg border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- user uploads from our storage */}
                  <img
                    src={e.screenshotUrl}
                    alt={`Screenshot from ${e.name}`}
                    className="max-h-56 w-full object-contain"
                  />
                </a>
              ) : (
                <p className="text-muted-foreground text-xs">No screenshot</p>
              )}
              {e.trackerUrl ? (
                <a
                  href={e.trackerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary text-sm underline"
                >
                  Tracker link
                </a>
              ) : null}
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`absent-${i}`}
                  checked={row.absent}
                  disabled={!editable}
                  onCheckedChange={(c) => setAbsent(i, c === true)}
                />
                <Label htmlFor={`absent-${i}`}>
                  {battleRoyale ? "Did not play (no-show)" : "Side did not show up (no-show)"}
                </Label>
              </div>
              {!row.absent ? (
                battleRoyale ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`pl-${i}`}>Placement</Label>
                      <Input
                        id={`pl-${i}`}
                        type="number"
                        min={1}
                        value={row.placement}
                        disabled={!editable}
                        aria-invalid={conflict}
                        onChange={(ev) => set(i, { placement: ev.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`k-${i}`}>Kills</Label>
                      <Input
                        id={`k-${i}`}
                        type="number"
                        min={0}
                        value={row.kills}
                        disabled={!editable}
                        onChange={(ev) => set(i, { kills: ev.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 items-end gap-2">
                    <label className="min-h-tap flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="winner"
                        checked={row.won}
                        disabled={!editable}
                        onChange={() => setRows((rs) => rs.map((r, j) => ({ ...r, won: j === i })))}
                      />
                      Winner
                    </label>
                    <div className="space-y-1">
                      <Label htmlFor={`rd-${i}`}>Round diff</Label>
                      <Input
                        id={`rd-${i}`}
                        type="number"
                        min={-13}
                        max={13}
                        value={row.roundDiff}
                        disabled={!editable}
                        onChange={(ev) => set(i, { roundDiff: ev.target.value })}
                      />
                    </div>
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {editable ? (
          <>
            <Button variant="secondary" disabled={save.pending} onClick={() => save.run(payload())}>
              Save
            </Button>
            <Button
              disabled={
                approve.pending ||
                conflicts.length > 0 ||
                (!battleRoyale && (nobodyPlayed || winners !== 1))
              }
              onClick={async () => {
                const saved = await save.run(payload());
                if (saved.ok) await approve.run({ matchId });
              }}
            >
              Approve and post points
            </Button>
          </>
        ) : null}
        {status === "COMPLETED" ? (
          canReopen ? (
            <>
              <div className="min-w-60 flex-1 space-y-1">
                <Label htmlFor="reopen-reason">Reason for reopening</Label>
                <Input
                  id="reopen-reason"
                  value={reason}
                  maxLength={300}
                  placeholder="e.g. dispute: wrong placement"
                  onChange={(ev) => setReason(ev.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                disabled={reopen.pending}
                onClick={() => {
                  if (
                    confirm(
                      "Reopen results? All points from this match are reversed until you approve again.",
                    )
                  )
                    void reopen.run({ matchId, reason: reason.trim() || undefined });
                }}
              >
                Reopen results
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {reopenBlockedReason ??
                "The 2-hour dispute window has passed. Only an admin can reopen."}
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
