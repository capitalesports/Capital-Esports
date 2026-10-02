"use client";

import { useState } from "react";
import { CrownIcon, UserIcon } from "lucide-react";
import { saveGameProfileAction } from "@/app/(site)/profile/actions";
import { FieldError } from "@/components/common/field-error";
import { useAction } from "@/components/common/use-action";
import type { GameProfileValue } from "@/components/profile/game-profile-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { isTeamMode, MODE_LABEL, type MatchMode } from "@/lib/match-modes";
import { formatINR } from "@/lib/money";
import { playerIdLabel } from "@/lib/player-label";
import { needsIgn } from "@/lib/profile";
import type { SavedTeam } from "./registration-panel";

export interface RegisterInput {
  /** Set when the roster comes from the player's saved team (the registration links to it). */
  teamId?: string;
  teamName?: string;
  players?: { gameId: string; ign?: string }[];
}

type Source = "saved" | "manual";

/** Pick teammates from the saved team: only those with a complete ID can be entered. */
function SavedTeamPicker({
  team,
  need,
  selected,
  onToggle,
  game,
  errors,
}: {
  team: SavedTeam;
  need: number;
  selected: string[];
  onToggle: (id: string) => void;
  game: Game;
  errors: string[];
}) {
  const ready = team.members.filter((m) => m.ready).length;
  const full = selected.length >= need;
  return (
    <fieldset className="border-border space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-xs font-semibold">
        Players 2–{need + 1} from {team.name} ({selected.length}/{need} picked)
      </legend>
      {team.members.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No teammates yet. Share your team code on the Teams page, or enter players manually.
        </p>
      ) : (
        <ul className="space-y-1">
          {team.members.map((m) => {
            const checked = selected.includes(m.id);
            const id = `saved-${m.id}`;
            return (
              <li key={m.id}>
                <label
                  htmlFor={id}
                  className={`min-h-tap flex items-center gap-3 rounded-md px-2 text-sm ${m.ready ? "cursor-pointer hover:bg-accent" : "opacity-60"}`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="accent-gold size-4"
                    checked={checked}
                    disabled={!m.ready || (!checked && full)}
                    onChange={() => onToggle(m.id)}
                  />
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {m.ready ? playerIdLabel(game, m.gameId, m.ign) : "ID missing on their profile"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {ready < need ? (
        <p className="text-muted-foreground text-xs">
          {ready} of your teammates {ready === 1 ? "has" : "have"} a complete{" "}
          {GAME_CONFIG[game].idLabel}; {need} are needed. Ask them to add it, or enter players
          manually.
        </p>
      ) : null}
      <FieldError id="reg-saved-error" messages={errors} />
    </fieldset>
  );
}

export interface MyIdDraft {
  gameId: string;
  ign: string;
}

/**
 * The registering player's own game ID (Player 1 · IGL in team modes), editable right here: filled
 * from the profile when it exists, typed in when it doesn't. Saved to the profile on submit.
 */
function MyIdFields({
  game,
  igl,
  draft,
  onChange,
  errors,
}: {
  game: Game;
  igl: boolean;
  draft: MyIdDraft;
  onChange: (patch: Partial<MyIdDraft>) => void;
  errors: Record<string, string[]>;
}) {
  const cfg = GAME_CONFIG[game];
  return (
    <fieldset className="border-gold/60 bg-gold/5 space-y-2 rounded-lg border p-3">
      <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold">
        {igl ? (
          <>
            <CrownIcon aria-hidden className="text-gold size-4" /> Player 1 · IGL (team leader) ·
            you
          </>
        ) : (
          <>
            <UserIcon aria-hidden className="text-gold size-4" /> Your details
          </>
        )}
      </legend>
      <div className="space-y-1">
        <Label htmlFor="reg-me-id" className="text-xs">
          {game === "VALORANT" ? "Your Riot ID (Name#TAG)" : `Your ${cfg.idLabel}`}
        </Label>
        <Input
          id="reg-me-id"
          value={draft.gameId}
          onChange={(e) => onChange({ gameId: e.target.value })}
          inputMode={game === "VALORANT" ? "text" : "numeric"}
          placeholder={game === "VALORANT" ? "Name#TAG" : "123456789"}
          autoComplete="off"
          aria-invalid={!!errors.gameId}
          required
        />
        <FieldError id="reg-me-id-error" messages={errors.gameId} />
      </div>
      {needsIgn(game) ? (
        <div className="space-y-1">
          <Label htmlFor="reg-me-ign" className="text-xs">
            Your exact in-game name
          </Label>
          <Input
            id="reg-me-ign"
            value={draft.ign}
            onChange={(e) => onChange({ ign: e.target.value })}
            placeholder="Same capitals and symbols"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!!errors.ign}
            required
          />
          <FieldError id="reg-me-ign-error" messages={errors.ign} />
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">Saved to your profile for next time.</p>
    </fieldset>
  );
}
/**
 * The registration pop-up (DECISIONS M14). Individual modes (Solo, Duo, 1v1) confirm the player's
 * own details. Team modes (Squad, 2v2, 4v4, 5v5) ask for a team name, show the registering player as
 * Player 1 · IGL, and collect every other player's game ID and exact in-game name.
 */
export function RegistrationDialog({
  open,
  onOpenChange,
  mode,
  size,
  playingAs,
  defaultTeamName,
  savedTeams = [],
  willWaitlist,
  entryFeePaise,
  pending,
  fieldErrors,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MatchMode;
  /** Players per team (1 for individual modes). */
  size: number;
  playingAs: { game: Game; value: GameProfileValue | null; complete: boolean };
  defaultTeamName: string;
  savedTeams?: SavedTeam[];
  willWaitlist: boolean;
  entryFeePaise: number;
  pending: boolean;
  fieldErrors: Record<string, string[]>;
  onSubmit: (input: RegisterInput) => Promise<void>;
}) {
  const game = playingAs.game;
  const cfg = GAME_CONFIG[game];
  const team = isTeamMode(mode);
  const withIgn = needsIgn(game);
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [players, setPlayers] = useState(() =>
    Array.from({ length: Math.max(0, size - 1) }, () => ({ gameId: "", ign: "" })),
  );
  const setPlayer = (i: number, patch: Partial<{ gameId: string; ign: string }>) =>
    setPlayers((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  // Valorant keeps the Riot ID as typed in `ign`; the canonical lower-case form is `gameId`.
  const initial: MyIdDraft = {
    gameId: (game === "VALORANT" ? playingAs.value?.ign : playingAs.value?.gameId) ?? "",
    ign: game === "VALORANT" ? "" : (playingAs.value?.ign ?? ""),
  };
  const [me, setMe] = useState(initial);
  // Two ways to fill a team roster: the saved team (Teams page) or typing every player's ID.
  const savedTeam = team ? savedTeams[0] : undefined;
  const need = size - 1;
  const [source, setSource] = useState<Source>(savedTeam ? "saved" : "manual");
  const [picked, setPicked] = useState<string[]>(() =>
    (savedTeam?.members ?? [])
      .filter((m) => m.ready)
      .slice(0, need)
      .map((m) => m.id),
  );
  const useSaved = source === "saved" && !!savedTeam;
  const pickedPlayers = (savedTeam?.members ?? []).filter((m) => picked.includes(m.id));
  const savedErrors = Object.entries(fieldErrors)
    .filter(([k]) => k === "players" || k.startsWith("players."))
    .flatMap(([k, v]) => {
      const i = Number(k.split(".")[1]);
      const who = Number.isNaN(i) ? null : pickedPlayers[i]?.name;
      return v.map((msg) => (who ? `${who}: ${msg}` : msg));
    });
  const saveId = useAction(saveGameProfileAction);
  const idChanged =
    !playingAs.complete ||
    me.gameId !== initial.gameId ||
    me.ign !== initial.ign;

  const submitLabel = willWaitlist
    ? "Join waitlist"
    : entryFeePaise > 0
      ? `${team ? "Register team" : "Register"} & pay ${formatINR(entryFeePaise)}`
      : team
        ? "Register team"
        : "Confirm registration";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {cfg.name} {MODE_LABEL[mode]} registration
          </DialogTitle>
          <DialogDescription>
            {team
              ? `Your team of ${size}: you are the IGL. Enter each player's ${cfg.idLabel}${withIgn ? " and exact in-game name" : ""}. Teammates don't need an account.`
              : "Check your details and confirm."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            // The player's own ID first (new or changed), then the registration.
            if (idChanged) {
              const saved = await saveId.run({
                game,
                gameId: me.gameId,
                ign: needsIgn(game) ? me.ign : undefined,
                // Indian players play on the AP server: no region field (DECISIONS M15).
                region: game === "VALORANT" ? (playingAs.value?.region ?? "AP") : undefined,
              });
              if (!saved.ok) return;
            }
            void onSubmit(
              !team
                ? {}
                : useSaved
                  ? {
                      teamId: savedTeam.id,
                      teamName: savedTeam.name,
                      players: pickedPlayers.map((p) =>
                        withIgn
                          ? { gameId: p.gameId ?? "", ign: p.ign ?? "" }
                          : { gameId: p.gameId ?? "" },
                      ),
                    }
                  : {
                      teamName,
                      players: players.map((p) => (withIgn ? p : { gameId: p.gameId })),
                    },
            );
          }}
        >
          {savedTeam ? (
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1.5 text-sm font-medium">How do you want to add players?</legend>
              {(
                [
                  ["saved", `Use my team · ${savedTeam.name}`],
                  ["manual", "Enter players manually"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`min-h-tap flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${source === value ? "border-gold bg-gold/10" : "border-border"}`}
                >
                  <input
                    type="radio"
                    name="reg-source"
                    value={value}
                    checked={source === value}
                    onChange={() => setSource(value)}
                    className="accent-gold size-4"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}

          {team && !useSaved ? (
            <div className="space-y-1.5">
              <Label htmlFor="reg-team-name">Team name</Label>
              <Input
                id="reg-team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={24}
                placeholder="e.g. Night Owls"
                aria-invalid={!!fieldErrors.teamName}
                aria-describedby="reg-team-name-error"
                required
              />
              <FieldError id="reg-team-name-error" messages={fieldErrors.teamName} />
            </div>
          ) : null}

          <MyIdFields
            game={game}
            igl={team}
            draft={me}
            onChange={(patch) => setMe((m) => ({ ...m, ...patch }))}
            errors={saveId.fieldErrors}
          />

          {useSaved ? (
            <SavedTeamPicker
              team={savedTeam}
              need={need}
              selected={picked}
              onToggle={(id) =>
                setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
              }
              game={game}
              errors={savedErrors}
            />
          ) : null}

          {(useSaved ? [] : players).map((p, i) => (
            <fieldset key={i} className="border-border space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-semibold">Player {i + 2}</legend>
              <div className="space-y-1">
                <Label htmlFor={`reg-p${i}-id`} className="text-xs">
                  {game === "VALORANT" ? "Riot ID (Name#TAG)" : cfg.idLabel}
                </Label>
                <Input
                  id={`reg-p${i}-id`}
                  value={p.gameId}
                  onChange={(e) => setPlayer(i, { gameId: e.target.value })}
                  inputMode={game === "VALORANT" ? "text" : "numeric"}
                  placeholder={game === "VALORANT" ? "Name#TAG" : "123456789"}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors[`players.${i}`]}
                  required
                />
              </div>
              {withIgn ? (
                <div className="space-y-1">
                  <Label htmlFor={`reg-p${i}-ign`} className="text-xs">
                    Exact in-game name
                  </Label>
                  <Input
                    id={`reg-p${i}-ign`}
                    value={p.ign}
                    onChange={(e) => setPlayer(i, { ign: e.target.value })}
                    placeholder="Same capitals and symbols"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={!!fieldErrors[`players.${i}`]}
                    required
                  />
                </div>
              ) : null}
              <FieldError id={`reg-p${i}-error`} messages={fieldErrors[`players.${i}`]} />
            </fieldset>
          ))}
          {useSaved ? null : <FieldError id="reg-players-error" messages={fieldErrors.players} />}

          <Button
            type="submit"
            className="w-full"
            disabled={pending || saveId.pending || (useSaved && picked.length !== need)}
          >
            {pending || saveId.pending ? "Registering…" : submitLabel}
          </Button>
          {team ? (
            <p className="text-muted-foreground text-xs">
              As IGL you are responsible for your players&apos; IDs: admins check them in the lobby.
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
