"use client";

import { useState } from "react";
import { saveGameProfileAction } from "@/app/(site)/profile/actions";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import { GameBadge } from "@/components/game/game-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { needsIgn } from "@/lib/profile";

export interface GameProfileValue {
  gameId: string;
  ign: string | null;
  region: string | null;
}

const HELP: Record<Game, string> = {
  FREE_FIRE: "Numeric UID and in-game name from your Free Fire profile. Admins use both to check you in the lobby.",
  BGMI: "Numeric Character ID and in-game name from your BGMI profile. Admins use both to check you in the lobby.",
  VALORANT: "Your Riot ID as Name#Tag. Admins use it to check you in the lobby.",
};

/**
 * Add or update a game ID. `inline` drops the card look (used inside the registration box and the
 * team form, where the ID is asked for when it's needed); `onSaved` runs after a successful save.
 */
export function GameProfileForm({
  game,
  value,
  inline = false,
  onSaved,
}: {
  game: Game;
  value: GameProfileValue | null;
  inline?: boolean;
  onSaved?: () => void;
}) {
  const cfg = GAME_CONFIG[game];
  // Valorant stores the canonical lower-case ID; show the display form (kept in `ign`).
  const [gameId, setGameId] = useState(
    game === "VALORANT" ? (value?.ign ?? "") : (value?.gameId ?? ""),
  );
  const withIgn = needsIgn(game);
  const [ign, setIgn] = useState(withIgn ? (value?.ign ?? "") : "");
  const { run, pending, fieldErrors } = useAction(saveGameProfileAction);
  const prefix = `gp-${cfg.slug}`;

  return (
    <form
      aria-labelledby={`${prefix}-title`}
      className={inline ? "space-y-3" : "card-ds-interactive space-y-3 p-4"}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({
          game,
          gameId,
          ign: withIgn ? ign : undefined,
          // Indian players play on the AP server: no region field (DECISIONS M15).
          region: game === "VALORANT" ? (value?.region ?? "AP") : undefined,
        });
        if (r.ok) onSaved?.();
      }}
    >
      <div className="flex items-center gap-2">
        <GameBadge game={game} />
        <h3 id={`${prefix}-title`} className="font-semibold">
          {cfg.name} ID
        </h3>
        {value ? <span className="text-success ml-auto text-xs">Linked</span> : null}
      </div>
      <p className="text-muted-foreground text-xs">{HELP[game]}</p>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-id`}>{cfg.idLabel}</Label>
        <Input
          id={`${prefix}-id`}
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          inputMode={game === "VALORANT" ? "text" : "numeric"}
          placeholder={game === "VALORANT" ? "Name#TAG" : "123456789"}
          aria-invalid={!!fieldErrors.gameId}
          aria-describedby={`${prefix}-id-error`}
          autoComplete="off"
        />
        <FieldError id={`${prefix}-id-error`} messages={fieldErrors.gameId} />
      </div>
      {withIgn ? (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-ign`}>Exact in-game name</Label>
          <Input
            id={`${prefix}-ign`}
            value={ign}
            onChange={(e) => setIgn(e.target.value)}
            aria-invalid={!!fieldErrors.ign}
            aria-describedby={`${prefix}-ign-help ${prefix}-ign-error`}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p id={`${prefix}-ign-help`} className="text-muted-foreground text-xs">
            Type it exactly as the game shows it: same capitals, symbols and spaces. Admins match it
            letter for letter in the lobby.
          </p>
          <FieldError id={`${prefix}-ign-error`} messages={fieldErrors.ign} />
        </div>
      ) : null}
      <Button type="submit" variant={inline ? "default" : "secondary"} disabled={pending}>
        {pending ? "Saving…" : value ? `Update ${cfg.name} ID` : `Add ${cfg.name} ID`}
      </Button>
    </form>
  );
}
