"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  createTeamAction,
  findTeamByCodeAction,
  inviteToTeamAction,
  joinTeamByCodeAction,
  leaveTeamAction,
  removeTeamMemberAction,
  respondToTeamInviteAction,
  transferCaptaincyAction,
} from "@/app/(site)/teams/actions";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { GameBadge } from "@/components/game/game-badge";
import { GameProfileForm } from "@/components/profile/game-profile-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GAME_CONFIG, GAME_LIST, type Game } from "@/lib/games";
import { TEAM_CODE_LENGTH } from "@/lib/team-code";

/**
 * Create a team for a game the player has no team in yet. Without that game's ID the form asks
 * for it first (game IDs are collected where they are needed, not on the profile).
 */
export function CreateTeamForm({
  availableGames,
  linkedGames,
}: {
  availableGames: Game[];
  linkedGames: Game[];
}) {
  const router = useRouter();
  // Start on a game the player already has an ID for, so they can name the team straight away.
  const [game, setGame] = useState<Game | "">(
    availableGames.find((g) => linkedGames.includes(g)) ?? availableGames[0] ?? "",
  );
  const [name, setName] = useState("");
  const { run, pending, fieldErrors } = useAction(createTeamAction);
  if (!availableGames.length) {
    return (
      <p className="text-muted-foreground text-sm">You are in a team for every game already.</p>
    );
  }
  const needsId = game !== "" && !linkedGames.includes(game);
  return (
    <div className="space-y-4">
      <FormField id="team-game" label="Game" errors={fieldErrors.game}>
        <NativeSelect
          id="team-game"
          value={game}
          onChange={(e) => setGame(e.target.value as Game)}
          className="sm:w-60"
        >
          {GAME_LIST.filter((g) => availableGames.includes(g.id)).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {needsId ? (
        <div className="card-ds space-y-2 p-4">
          <p className="text-muted-foreground text-sm">
            Add your {GAME_CONFIG[game].idLabel} first. Teammates invite each other by game ID.
          </p>
          <GameProfileForm game={game} value={null} inline onSaved={() => router.refresh()} />
        </div>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({ game, name });
            if (r.ok) setName("");
          }}
        >
          <FormField id="team-name" label="Team name" errors={fieldErrors.name}>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            Create team
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * Join a team with the code its members share (DECISIONS M17). The code shows the team first; a
 * player without an ID for that game adds it right here, then joins.
 */
export function JoinTeamForm({ readyGames }: { readyGames: Game[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<{
    code: string;
    name: string;
    game: Game;
    captain: string;
    members: number;
  } | null>(null);
  const lookup = useAction(findTeamByCodeAction);
  const join = useAction(joinTeamByCodeAction);
  const needsId = found !== null && !readyGames.includes(found.game);

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await lookup.run({ code });
          setFound(r.ok ? r.data : null);
        }}
      >
        <FormField id="join-code" label="Team code" errors={lookup.fieldErrors.code}>
          <Input
            id="join-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setFound(null);
            }}
            maxLength={TEAM_CODE_LENGTH + 2}
            placeholder="e.g. KQZTR"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-widest"
          />
        </FormField>
        <Button type="submit" variant="gold-outline" disabled={lookup.pending || !code.trim()}>
          Find team
        </Button>
      </form>
      {found ? (
        <div className="card-ds space-y-3 p-4" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <GameBadge game={found.game} />
            <strong>{found.name}</strong>
            <span className="text-muted-foreground">
              captain {found.captain} · {found.members} player{found.members === 1 ? "" : "s"}
            </span>
          </p>
          {needsId ? (
            <>
              <p className="text-muted-foreground text-sm">
                Add your {GAME_CONFIG[found.game].idLabel} to join this {GAME_CONFIG[found.game].name}{" "}
                team.
              </p>
              <GameProfileForm
                game={found.game}
                value={null}
                inline
                onSaved={() => router.refresh()}
              />
            </>
          ) : (
            <Button
              disabled={join.pending}
              onClick={async () => {
                const r = await join.run({ code: found.code });
                if (r.ok) {
                  setCode("");
                  setFound(null);
                }
              }}
            >
              Join {found.name}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TeamCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="ml-auto flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Code</span>
      <span className="border-border rounded-md border px-2 py-1 font-mono font-semibold tracking-widest">
        {code}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={copied ? "Team code copied" : "Copy team code"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked: the code is still on screen to copy by hand.
          }
        }}
      >
        {copied ? <CheckIcon aria-hidden className="text-success" /> : <CopyIcon aria-hidden />}
      </Button>
    </span>
  );
}

export interface TeamView {
  id: string;
  game: Game;
  name: string;
  joinCode: string;
  captainId: string;
  members: { userId: string; name: string; gameLabel: string; status: "INVITED" | "CONFIRMED" }[];
}

export function TeamCard({ team, meId }: { team: TeamView; meId: string }) {
  const isCaptain = team.captainId === meId;
  const [gameId, setGameId] = useState("");
  const invite = useAction(inviteToTeamAction);
  const leave = useAction(leaveTeamAction);
  const remove = useAction(removeTeamMemberAction);
  const transfer = useAction(transferCaptaincyAction);
  const cfg = GAME_CONFIG[team.game];

  return (
    <article aria-label={`Team ${team.name}`} className="card-ds space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GameBadge game={team.game} />
        <h3 className="font-semibold">{team.name}</h3>
        {isCaptain ? <span className="text-muted-foreground text-xs">You are captain</span> : null}
        <TeamCode code={team.joinCode} />
      </div>
      <p className="text-muted-foreground text-xs">
        Share the code: players join with “Join a team” on their Teams page.
      </p>
      <ul className="space-y-2">
        {team.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{m.name}</span>
            <span className="text-muted-foreground">{m.gameLabel}</span>
            {m.userId === team.captainId ? (
              <span className="text-primary text-xs">Captain</span>
            ) : null}
            {m.status === "INVITED" ? <span className="text-warning text-xs">Invited</span> : null}
            {isCaptain && m.userId !== meId ? (
              <span className="ml-auto flex gap-1">
                {m.status === "CONFIRMED" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={transfer.pending}
                    onClick={() => transfer.run({ teamId: team.id, userId: m.userId })}
                  >
                    Make captain
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.pending}
                  onClick={() => remove.run({ teamId: team.id, userId: m.userId })}
                >
                  Remove
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {isCaptain ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await invite.run({ teamId: team.id, gameId });
            if (r.ok) setGameId("");
          }}
        >
          <div className="grow">
            <FormField
              id={`invite-${team.id}`}
              label={`Invite by ${cfg.idLabel}`}
              errors={invite.fieldErrors.gameId}
            >
              <Input
                id={`invite-${team.id}`}
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder={team.game === "VALORANT" ? "Name#TAG" : "123456789"}
              />
            </FormField>
          </div>
          <Button type="submit" variant="secondary" disabled={invite.pending || !gameId}>
            Invite
          </Button>
        </form>
      ) : null}
      <Button
        variant="outline"
        disabled={leave.pending}
        onClick={() => {
          if (
            confirm(
              isCaptain && team.members.length === 1
                ? "Leaving deletes the team. Continue?"
                : "Leave this team?",
            )
          )
            void leave.run({ teamId: team.id });
        }}
      >
        Leave team
      </Button>
    </article>
  );
}

export function TeamInvite({
  teamId,
  name,
  game,
  captain,
}: {
  teamId: string;
  name: string;
  game: Game;
  captain: string;
}) {
  const { run, pending } = useAction(respondToTeamInviteAction);
  return (
    <li className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <GameBadge game={game} />
      <span>
        <strong>{name}</strong> (captain {captain}) invited you
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => run({ teamId, accept: true })}>
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run({ teamId, accept: false })}
        >
          Decline
        </Button>
      </span>
    </li>
  );
}
