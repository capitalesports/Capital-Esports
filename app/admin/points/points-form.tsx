"use client";

import { useState } from "react";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { savePointsConfigAction } from "./actions";

export interface PointsFormValues {
  placementPoints: string;
  killPoints: string;
  winPoints: string;
  lossPoints: string;
  tournamentMultiplier: string;
}

/** One game's scoring. Lobby modes use placement + kills; head-to-head modes use win/loss. */
export function PointsForm({ game, initial }: { game: Game; initial: PointsFormValues }) {
  const [v, setV] = useState(initial);
  const { run, pending, fieldErrors } = useAction(savePointsConfigAction);
  const id = (k: keyof PointsFormValues) => `${game}-${k}`;
  const field = (k: keyof PointsFormValues, label: string, help?: string, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <FormField id={id(k)} label={label} help={help} errors={fieldErrors[k]}>
        <Input
          id={id(k)}
          inputMode={k === "placementPoints" ? "text" : "numeric"}
          aria-invalid={!!fieldErrors[k]}
          aria-describedby={`${id(k)}-help ${id(k)}-error`}
          value={v[k]}
          onChange={(e) => setV({ ...v, [k]: e.target.value })}
        />
      </FormField>
    </div>
  );
  return (
    <form
      aria-label={`${GAME_CONFIG[game].name} points`}
      className="card-ds grid gap-4 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ game, ...v });
      }}
    >
      <h2 className="sm:col-span-2">{GAME_CONFIG[game].name}</h2>
      {field(
        "placementPoints",
        "Placement points (lobby modes)",
        "Comma list, 1st place first, e.g. 15, 12, 10, 8. Places beyond the list score 0.",
        true,
      )}
      {field("killPoints", "Points per kill (lobby modes)")}
      {field("tournamentMultiplier", "Tournament multiplier", "Tournament matches score × this")}
      {field("winPoints", "Win points (head-to-head)", "1v1, 2v2, 4v4 and 5v5 matches")}
      {field("lossPoints", "Loss points (head-to-head)")}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save ${GAME_CONFIG[game].name} points`}
        </Button>
      </div>
    </form>
  );
}
