"use client";

import { useState } from "react";
import { submitResultAction } from "@/app/(site)/scrims/[id]/actions";
import { FormField } from "@/components/common/form-field";
import { downscaleImage } from "@/components/common/resize-image";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MatchMode } from "@/lib/match-modes";

export function ResultSubmitForm({
  matchId,
  battleRoyale,
  mode,
  existing,
}: {
  matchId: string;
  battleRoyale: boolean;
  /** Head-to-head wording: "I won" for 1v1, "We won" for team modes. */
  mode?: MatchMode;
  existing: {
    placement: number | null;
    kills: number | null;
    won: boolean | null;
    roundDiff?: number | null;
    hasScreenshot: boolean;
  } | null;
}) {
  const [placement, setPlacement] = useState(existing?.placement?.toString() ?? "");
  const [kills, setKills] = useState(existing?.kills?.toString() ?? "");
  const [won, setWon] = useState<"true" | "false">(existing?.won ? "true" : "false");
  const [roundDiff, setRoundDiff] = useState(
    existing?.roundDiff == null ? "" : Math.abs(existing.roundDiff).toString(),
  );
  const [trackerUrl, setTrackerUrl] = useState("");
  const solo = mode === "ONE_V_ONE";
  const [file, setFile] = useState<File | null>(null);
  const { run, pending, fieldErrors } = useAction(submitResultAction);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.set("matchId", matchId);
    if (battleRoyale) {
      form.set("placement", placement);
      form.set("kills", kills);
    } else {
      form.set("won", won);
      if (roundDiff) form.set("roundDiff", roundDiff);
      if (trackerUrl) form.set("trackerUrl", trackerUrl);
    }
    if (file) form.set("screenshot", await downscaleImage(file), "screenshot");
    await run(form);
  }

  return (
    <section aria-labelledby="submit-result-h" className="card-ds space-y-3 p-4">
      <h2 id="submit-result-h" className="font-semibold">
        Submit your result
      </h2>
      <p className="text-muted-foreground text-sm">
        {existing
          ? "You already submitted. Submitting again replaces it until a moderator approves. "
          : ""}
        {battleRoyale
          ? "Upload the end-screen screenshot and enter your placement and kills."
          : "Upload the scoreboard screenshot or paste a tracker link."}
      </p>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
        {battleRoyale ? (
          <>
            <FormField id="res-placement" label="Placement" errors={fieldErrors.placement}>
              <Input
                id="res-placement"
                type="number"
                min={1}
                inputMode="numeric"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
              />
            </FormField>
            <FormField id="res-kills" label="Kills" errors={fieldErrors.kills}>
              <Input
                id="res-kills"
                type="number"
                min={0}
                inputMode="numeric"
                value={kills}
                onChange={(e) => setKills(e.target.value)}
              />
            </FormField>
          </>
        ) : (
          <>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Result</legend>
              <div className="flex gap-4">
                {(["true", "false"] as const).map((v) => (
                  <label key={v} className="min-h-tap flex items-center gap-2">
                    <input
                      type="radio"
                      name="won"
                      value={v}
                      checked={won === v}
                      onChange={() => setWon(v)}
                    />
                    {v === "true" ? (solo ? "I won" : "We won") : solo ? "I lost" : "We lost"}
                  </label>
                ))}
              </div>
            </fieldset>
            <FormField
              id="res-rounddiff"
              label="Round difference (optional)"
              help={`Rounds ${won === "true" ? "won" : "lost"} by, 0 to 13.`}
              errors={fieldErrors.roundDiff}
            >
              <Input
                id="res-rounddiff"
                type="number"
                min={0}
                max={13}
                inputMode="numeric"
                value={roundDiff}
                onChange={(e) => setRoundDiff(e.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField
                id="res-tracker"
                label="Tracker link (optional)"
                errors={fieldErrors.trackerUrl}
              >
                <Input
                  id="res-tracker"
                  type="url"
                  placeholder="https://tracker.gg/valorant/match/..."
                  value={trackerUrl}
                  onChange={(e) => setTrackerUrl(e.target.value)}
                />
              </FormField>
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <FormField
            id="res-screenshot"
            label={battleRoyale ? "End-screen screenshot" : "Scoreboard screenshot"}
            help={
              existing?.hasScreenshot
                ? "A screenshot is already attached; choose a file only to replace it."
                : "PNG, JPEG or WebP, up to 5 MB."
            }
            errors={fieldErrors.screenshot}
          >
            <Input
              id="res-screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Uploading…" : "Submit result"}
          </Button>
        </div>
      </form>
    </section>
  );
}
