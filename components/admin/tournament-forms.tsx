"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addLobbyMatchesAction,
  cancelTournamentAction,
  createTournamentAction,
  generateBracketAction,
  lockEntriesAction,
  publishWinnersAction,
  updateTournamentAction,
} from "@/app/admin/tournaments/actions";
import { FormField } from "@/components/common/form-field";
import { IstDateTimePicker } from "@/components/admin/ist-date-time-picker";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GAME_LIST, type Game } from "@/lib/games";
import {
  capacityText,
  isHeadToHead,
  isTeamMode,
  MODE_LABEL,
  MODES_FOR_GAME,
  type MatchMode,
} from "@/lib/match-modes";

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="card-ds space-y-3 p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Who pays and when: the team captain (team modes) or the player, while signing up. */
function entryFeeHelp(paymentsEnabled: boolean, team: boolean): string {
  const who = team ? "The captain pays for the team" : "Each player pays";
  return paymentsEnabled
    ? `${who} when signing up. 0 = free. Refunded if the tournament is cancelled.`
    : "0 = free. Payments are switched off, so a paid tournament can't take sign-ups yet.";
}

export function CreateTournamentForm({ paymentsEnabled }: { paymentsEnabled: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({
    game: "BGMI" as Game,
    mode: "SQUAD" as MatchMode,
    title: "",
    startsAt: "",
    prizePool: "0",
    entryFee: "0",
    rulesMarkdown: "",
    streamUrl: "",
  });
  const { run, pending, fieldErrors } = useAction(createTournamentAction);
  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));
  const bracket = isHeadToHead(v.mode);
  const onGameChange = (game: Game) =>
    setV((p) => ({
      ...p,
      game,
      mode: MODES_FOR_GAME[game].includes(p.mode) ? p.mode : MODES_FOR_GAME[game][0]!,
    }));
  return (
    <form
      className="grid max-w-3xl gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(v);
        if (r.ok) router.push(`/admin/tournaments/${r.data}`);
      }}
    >
      <FormField id="t-game" label="Game" errors={fieldErrors.game}>
        <NativeSelect
          id="t-game"
          value={v.game}
          onChange={(e) => onGameChange(e.target.value as Game)}
        >
          {GAME_LIST.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField
        id="t-mode"
        label="Mode"
        help={
          bracket
            ? "Head-to-head: single-elimination bracket. Unlimited sign-ups; an odd one out gets a bye."
            : `Lobby: placement + kill points across matches. Unlimited sign-ups, split into lobbies at close. ${capacityText(v.game, v.mode)}.`
        }
        errors={fieldErrors.mode}
      >
        <NativeSelect id="t-mode" value={v.mode} onChange={(e) => set("mode", e.target.value)}>
          {MODES_FOR_GAME[v.game].map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id="t-title" label="Title" errors={fieldErrors.title}>
        <Input
          id="t-title"
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="BGMI Weekly Cup"
        />
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="t-startsAt"
          label="Starts (IST)"
          help="Sign-ups close 30 minutes before"
          errors={fieldErrors.startsAt}
        >
          <IstDateTimePicker
            id="t-startsAt"
            label="Tournament start"
            value={v.startsAt}
            invalid={!!fieldErrors.startsAt}
            onChange={(val) => set("startsAt", val)}
          />
        </FormField>
      </div>
      <FormField id="t-prize" label="Prize pool (₹)" errors={fieldErrors.prizePool}>
        <Input
          id="t-prize"
          inputMode="decimal"
          value={v.prizePool}
          onChange={(e) => set("prizePool", e.target.value)}
        />
      </FormField>
      <FormField
        id="t-fee"
        label="Entry fee (₹)"
        help={entryFeeHelp(paymentsEnabled, isTeamMode(v.mode))}
        errors={fieldErrors.entryFee}
      >
        <Input
          id="t-fee"
          inputMode="decimal"
          value={v.entryFee}
          onChange={(e) => set("entryFee", e.target.value)}
        />
      </FormField>
      <FormField id="t-stream" label="Stream URL (optional)" errors={fieldErrors.streamUrl}>
        <Input
          id="t-stream"
          type="url"
          value={v.streamUrl}
          onChange={(e) => set("streamUrl", e.target.value)}
          placeholder="https://youtube.com/..."
        />
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="t-rules" label="Rules (markdown)" errors={fieldErrors.rulesMarkdown}>
          <Textarea
            id="t-rules"
            rows={6}
            value={v.rulesMarkdown}
            onChange={(e) => set("rulesMarkdown", e.target.value)}
          />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Create tournament
        </Button>
      </div>
    </form>
  );
}

export interface TournamentStructure {
  game: Game;
  mode: MatchMode;
  /** IST datetime-local value */
  startsAt: string;
  /** rupees */
  entryFee: string;
}

/** Start time, mode and entry fee: editable only while nobody has signed up and no matches exist. */
function StructureFields({
  s,
  onChange,
  fieldErrors,
  paymentsEnabled,
}: {
  s: TournamentStructure;
  onChange: (s: TournamentStructure) => void;
  fieldErrors: Record<string, string[] | undefined>;
  paymentsEnabled: boolean;
}) {
  const bracket = isHeadToHead(s.mode);
  return (
    <>
      <div className="sm:col-span-2">
        <FormField
          id="e-startsAt"
          label="Starts (IST)"
          help="Sign-ups close 30 minutes before"
          errors={fieldErrors.startsAt}
        >
          <IstDateTimePicker
            id="e-startsAt"
            label="Tournament start"
            value={s.startsAt}
            invalid={!!fieldErrors.startsAt}
            onChange={(val) => onChange({ ...s, startsAt: val })}
          />
        </FormField>
      </div>
      <FormField
        id="e-mode"
        label="Mode"
        help={bracket ? undefined : capacityText(s.game, s.mode)}
        errors={fieldErrors.mode}
      >
        <NativeSelect
          id="e-mode"
          value={s.mode}
          onChange={(e) => onChange({ ...s, mode: e.target.value as MatchMode })}
        >
          {MODES_FOR_GAME[s.game].map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField
        id="e-fee"
        label="Entry fee (₹)"
        help={entryFeeHelp(paymentsEnabled, isTeamMode(s.mode))}
        errors={fieldErrors.entryFee}
      >
        <Input
          id="e-fee"
          inputMode="decimal"
          value={s.entryFee}
          onChange={(e) => onChange({ ...s, entryFee: e.target.value })}
        />
      </FormField>
    </>
  );
}

export function EditTournamentForm({
  t,
  structure,
  paymentsEnabled,
}: {
  t: { id: string; title: string; prizePool: string; rulesMarkdown: string; streamUrl: string };
  /** Present only while start, mode and entry fee may still change. */
  structure?: TournamentStructure;
  paymentsEnabled: boolean;
}) {
  const [v, setV] = useState(t);
  const [s, setS] = useState(structure);
  const { run, pending, fieldErrors } = useAction(updateTournamentAction);
  return (
    <Box title="Details">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run({
            tournamentId: t.id,
            title: v.title,
            prizePool: v.prizePool,
            rulesMarkdown: v.rulesMarkdown,
            streamUrl: v.streamUrl || undefined,
            ...(s
              ? {
                  startsAt: s.startsAt,
                  mode: s.mode,
                  entryFee: s.entryFee,
                }
              : {}),
          });
        }}
      >
        {s ? (
          <StructureFields
            s={s}
            onChange={setS}
            fieldErrors={fieldErrors}
            paymentsEnabled={paymentsEnabled}
          />
        ) : null}
        <FormField id="e-title" label="Title" errors={fieldErrors.title}>
          <Input
            id="e-title"
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </FormField>
        <FormField id="e-prize" label="Prize pool (₹)" errors={fieldErrors.prizePool}>
          <Input
            id="e-prize"
            value={v.prizePool}
            onChange={(e) => setV({ ...v, prizePool: e.target.value })}
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="e-stream" label="Stream URL" errors={fieldErrors.streamUrl}>
            <Input
              id="e-stream"
              value={v.streamUrl}
              onChange={(e) => setV({ ...v, streamUrl: e.target.value })}
            />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <FormField id="e-rules" label="Rules (markdown)" errors={fieldErrors.rulesMarkdown}>
            <Textarea
              id="e-rules"
              rows={6}
              value={v.rulesMarkdown}
              onChange={(e) => setV({ ...v, rulesMarkdown: e.target.value })}
            />
          </FormField>
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Save details
          </Button>
        </div>
      </form>
    </Box>
  );
}

export function LobbyMatchesForm({
  tournamentId,
  defaultStart,
  locked,
}: {
  tournamentId: string;
  defaultStart: string;
  /** Registration closed: entries are split into lobbies (new matches are split the same way). */
  locked: boolean;
}) {
  const [v, setV] = useState({ count: "3", firstStartsAt: defaultStart, gapMinutes: "45" });
  const add = useAction(addLobbyMatchesAction);
  const lock = useAction(lockEntriesAction);
  return (
    <Box title="Lobby matches">
      <form
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run({ tournamentId, ...v });
        }}
      >
        <FormField id="l-count" label="How many" errors={add.fieldErrors.count}>
          <Input
            id="l-count"
            type="number"
            min={1}
            max={10}
            value={v.count}
            onChange={(e) => setV({ ...v, count: e.target.value })}
          />
        </FormField>
        <div className="sm:order-first sm:col-span-4">
          <FormField id="l-first" label="First match (IST)" errors={add.fieldErrors.firstStartsAt}>
            <IstDateTimePicker
              id="l-first"
              label="First match"
              value={v.firstStartsAt}
              invalid={!!add.fieldErrors.firstStartsAt}
              onChange={(val) => setV({ ...v, firstStartsAt: val })}
            />
          </FormField>
        </div>
        <FormField id="l-gap" label="Minutes apart" errors={add.fieldErrors.gapMinutes}>
          <Input
            id="l-gap"
            type="number"
            min={15}
            value={v.gapMinutes}
            onChange={(e) => setV({ ...v, gapMinutes: e.target.value })}
          />
        </FormField>
        <Button type="submit" variant="secondary" disabled={add.pending}>
          Add matches
        </Button>
      </form>
      {locked ? (
        <p className="text-muted-foreground text-sm">
          Registration is closed and entries are split into lobbies, the same lobby in every match.
          Matches added now are split the same way.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Registration closes 30 minutes before the start; entries are then split into balanced
            lobbies (no match added = one match at the start time). Close it now instead:
          </p>
          <Button disabled={lock.pending} onClick={() => lock.run({ tournamentId })}>
            Close registration and split lobbies
          </Button>
        </>
      )}
    </Box>
  );
}

export function GenerateBracketForm({
  tournamentId,
  defaultStart,
  confirmed,
}: {
  tournamentId: string;
  defaultStart: string;
  confirmed: number;
}) {
  const [start, setStart] = useState(defaultStart);
  const { run, pending, fieldErrors } = useAction(generateBracketAction);
  return (
    <Box title="Bracket">
      <p className="text-muted-foreground text-sm">
        {confirmed} entries confirmed. Registration closes 30 minutes before the start and the
        bracket is drawn in sign-up order (1v2, 3v4, …); an odd one out gets a bye to the next
        round. Draw it now instead:
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ tournamentId, firstRoundStartsAt: start });
        }}
      >
        <div className="w-full">
          <FormField
            id="b-start"
            label="Round 1 starts (IST)"
            errors={fieldErrors.firstRoundStartsAt}
          >
            <IstDateTimePicker
              id="b-start"
              label="Round 1 start"
              value={start}
              invalid={!!fieldErrors.firstRoundStartsAt}
              onChange={setStart}
            />
          </FormField>
        </div>
        <Button type="submit" disabled={pending}>
          Draw bracket now
        </Button>
      </form>
    </Box>
  );
}

export function CancelTournamentForm({ tournamentId }: { tournamentId: string }) {
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useAction(cancelTournamentAction);
  return (
    <Box title="Cancel tournament">
      <p className="text-muted-foreground text-sm">
        Cancels the sign-up list and every match that has not finished; paid entries are refunded
        and players are notified. This cannot be undone.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm("Cancel this tournament and refund every entry?"))
            void run({ tournamentId, reason });
        }}
      >
        <div className="min-w-60 flex-1">
          <FormField id="c-reason" label="Reason (shown to players)" errors={fieldErrors.reason}>
            <Input
              id="c-reason"
              value={reason}
              maxLength={250}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
        <Button type="submit" variant="destructive" disabled={pending}>
          Cancel tournament
        </Button>
      </form>
    </Box>
  );
}

export function PublishWinnersForm({
  tournamentId,
  prizePool,
}: {
  tournamentId: string;
  prizePool: number;
}) {
  const split = [0.5, 0.3, 0.2].map((f) => String(Math.round((prizePool / 100) * f)));
  const [prizes, setPrizes] = useState(split);
  const { run, pending } = useAction(publishWinnersAction);
  return (
    <Box title="Publish winners">
      <p className="text-muted-foreground text-sm">
        Top 3 come from the final standings (or bracket). Publishing adds a card to the home
        carousel.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ tournamentId, prizes });
        }}
      >
        {["1st", "2nd", "3rd"].map((label, i) => (
          <FormField key={label} id={`prize-${i}`} label={`${label} prize (₹)`}>
            <Input
              id={`prize-${i}`}
              inputMode="decimal"
              value={prizes[i]}
              onChange={(e) => setPrizes((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </FormField>
        ))}
        <Button type="submit" disabled={pending}>
          Publish winners
        </Button>
      </form>
    </Box>
  );
}
