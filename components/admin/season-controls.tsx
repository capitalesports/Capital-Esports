"use client";

import { useState } from "react";
import { endSeasonAction, startSeasonAction } from "@/app/admin/seasons/actions";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Game } from "@/lib/games";

export function EndSeasonButton({ seasonId, name }: { seasonId: string; name: string }) {
  const { run, pending } = useAction(endSeasonAction);
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (confirm(`End ${name} now? Standings are archived and the top 3 become champions.`))
          void run({ seasonId });
      }}
    >
      End season
    </Button>
  );
}

export function StartSeasonForm({
  game,
  defaultName,
  defaultDate,
}: {
  game: Game;
  defaultName: string;
  defaultDate: string;
}) {
  const [name, setName] = useState(defaultName);
  const [startsOn, setStartsOn] = useState(defaultDate);
  const { run, pending, fieldErrors } = useAction(startSeasonAction);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ game, name, startsOn });
      }}
    >
      <FormField id={`sn-${game}`} label="Name" errors={fieldErrors.name}>
        <Input id={`sn-${game}`} value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField id={`sd-${game}`} label="Starts (IST)" errors={fieldErrors.startsOn}>
        <Input
          id={`sd-${game}`}
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
        />
      </FormField>
      <Button type="submit" disabled={pending}>
        Start season
      </Button>
    </form>
  );
}
