"use client";

import { useState } from "react";
import { editRosterPlayerAction } from "@/app/admin/matches/actions";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GAME_CONFIG, type Game } from "@/lib/games";

/** Replace one roster player's game ID and in-game name (wrong or duplicated player). */
export function RosterPlayerEdit({
  matchId,
  memberId,
  game,
  gameId,
  ign,
  children,
}: {
  matchId: string;
  memberId: string;
  game: Game;
  gameId: string | null;
  ign: string | null;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState(gameId ?? "");
  const [name, setName] = useState(ign ?? "");
  const { run, pending, fieldErrors } = useAction(editRosterPlayerAction);
  // Valorant: the Riot ID is the name.
  const withName = game !== "VALORANT";
  const label = GAME_CONFIG[game].idLabel;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        {children}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground px-2 text-xs"
          aria-label={`Edit ${ign ?? gameId ?? "player"}`}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      </span>
    );
  }
  return (
    <form
      className="flex min-w-56 flex-col gap-2 py-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ matchId, memberId, gameId: id, ...(withName ? { ign: name } : {}) });
        if (r.ok) setEditing(false);
      }}
    >
      <FormField id={`roster-id-${memberId}`} label={label} errors={fieldErrors.gameId}>
        <Input
          id={`roster-id-${memberId}`}
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoComplete="off"
        />
      </FormField>
      {withName ? (
        <FormField id={`roster-ign-${memberId}`} label="In-game name" errors={fieldErrors.ign}>
          <Input
            id={`roster-ign-${memberId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </FormField>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save player
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
