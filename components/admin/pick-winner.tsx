"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrophyIcon } from "lucide-react";
import { declareWinnerAction } from "@/app/admin/tournaments/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Entry = { registrationId: string; name: string };

/**
 * After a two-team bracket game (DECISIONS M65): pick the winner, enter the score in rounds (the
 * round difference is the points tie-breaker), confirm. The winner moves to the next round; the
 * game's room details are removed.
 */
export function PickWinnerButtons({
  tournamentId,
  matchId,
  entries,
}: {
  tournamentId: string;
  matchId: string;
  entries: Entry[];
}) {
  const router = useRouter();
  const [winner, setWinner] = useState<Entry | null>(null);
  const [won, setWon] = useState("");
  const [lost, setLost] = useState("");
  const { run, pending, fieldErrors } = useAction(declareWinnerAction);
  const loser = winner ? entries.find((e) => e.registrationId !== winner.registrationId) : null;
  const w = Number(won);
  const l = Number(lost);
  const scored = won !== "" && lost !== "";
  const bad = scored && !(w > l);

  if (!winner) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {entries.map((e) => (
          <Button
            key={e.registrationId}
            type="button"
            size="sm"
            variant="gold-outline"
            onClick={() => setWinner(e)}
          >
            <TrophyIcon aria-hidden /> {e.name} won
          </Button>
        ))}
      </div>
    );
  }

  function reset() {
    setWinner(null);
    setWon("");
    setLost("");
  }

  return (
    <form
      className="border-gold/50 w-full space-y-3 rounded-lg border p-3"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const r = await run({
          tournamentId,
          matchId,
          winnerRegistrationId: winner.registrationId,
          ...(scored ? { winnerRounds: won, loserRounds: lost } : {}),
        });
        if (r.ok) router.refresh();
      }}
    >
      <p className="text-sm">
        <TrophyIcon aria-hidden className="text-gold mr-1 inline size-4" />
        <span className="font-semibold">{winner.name}</span> won against {loser?.name ?? "—"}. Score
        in rounds:
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground block">{winner.name} rounds won</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={13}
            className="w-24"
            value={won}
            aria-invalid={bad || !!fieldErrors.winnerRounds}
            onChange={(e) => setWon(e.target.value)}
          />
        </label>
        <span className="text-muted-foreground pb-3">–</span>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground block">
            {loser?.name ?? "Other team"} rounds won
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={13}
            className="w-24"
            value={lost}
            aria-invalid={bad}
            onChange={(e) => setLost(e.target.value)}
          />
        </label>
        <p className="pb-3 text-sm" role="status">
          {bad ? (
            <span className="text-destructive">The winner needs more rounds.</span>
          ) : scored ? (
            <>
              Round difference: <span className="text-gold font-semibold">+{w - l}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Optional: leave empty to skip the score.</span>
          )}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        {winner.name} moves to the next round and this game&apos;s room details are removed from
        both teams.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || bad}>
          Confirm winner
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
