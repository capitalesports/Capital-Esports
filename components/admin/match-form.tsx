"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createMatchAction, updateMatchAction } from "@/app/admin/matches/actions";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { IstDateTimePicker } from "@/components/admin/ist-date-time-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GAME_CONFIG, GAME_LIST, type Game } from "@/lib/games";
import {
  capacityText,
  isHeadToHead,
  maxSlotsFor,
  MODE_LABEL,
  MODES_FOR_GAME,
  slotUnit,
  type MatchMode,
} from "@/lib/match-modes";
import type { MatchFormInput } from "@/lib/match-schema";

export interface MatchFormValues {
  game: Game;
  kind: "SCRIM" | "TOURNAMENT";
  mode: MatchMode;
  title: string;
  description: string;
  startsAt: string;
  registrationOpensAt: string;
  closeOffsetMinutes: string;
  minSlots: string;
  entryFee: string;
  prize: string;
  streamUrl: string;
  tournamentId: string;
}

export const EMPTY_MATCH_FORM: MatchFormValues = {
  game: "FREE_FIRE",
  kind: "SCRIM",
  mode: "SQUAD",
  title: "",
  description: "",
  startsAt: "",
  registrationOpensAt: "",
  closeOffsetMinutes: "30",
  minSlots: "2",
  entryFee: "0",
  prize: "0",
  streamUrl: "",
  tournamentId: "",
};

export function MatchForm({
  matchId,
  initial,
  tournaments,
  paymentsEnabled,
  lockGameAndMode = false,
}: {
  matchId?: string;
  initial: MatchFormValues;
  tournaments: { id: string; title: string; game: Game; mode: MatchMode }[];
  paymentsEnabled: boolean;
  /** Players have registered: game, mode and kind can no longer change. */
  lockGameAndMode?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<MatchFormValues>(initial);
  const create = useAction(createMatchAction);
  const update = useAction((input: MatchFormInput) => updateMatchAction(matchId!, input));
  const { pending, fieldErrors } = matchId ? update : create;
  const set = <K extends keyof MatchFormValues>(k: K, val: MatchFormValues[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  function onGameChange(game: Game) {
    const mode = MODES_FOR_GAME[game].includes(v.mode) ? v.mode : MODES_FOR_GAME[game][0]!;
    setV((p) => ({
      ...p,
      game,
      mode,
      tournamentId: "",
    }));
  }

  function onModeChange(mode: MatchMode) {
    setV((p) => ({
      ...p,
      mode,
      tournamentId: "",
    }));
  }

  const headToHead = isHeadToHead(v.mode);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: MatchFormInput = {
      ...v,
      // A head-to-head match is always two sides.
      minSlots: headToHead ? String(Math.min(Number(v.minSlots) || 0, 2)) : v.minSlots,
      description: v.description || undefined,
      registrationOpensAt: v.registrationOpensAt || undefined,
      streamUrl: v.streamUrl || undefined,
      tournamentId: v.tournamentId || undefined,
    };
    const result = matchId ? await update.run(input) : await create.run(input);
    if (result.ok) router.push(`/admin/matches/${result.data}`);
  }

  const err = (k: string) => fieldErrors[k];
  const ids = (k: string) => ({
    id: `m-${k}`,
    "aria-invalid": !!err(k),
    "aria-describedby": `m-${k}-help m-${k}-error`,
  });

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2" noValidate>
      <FormField
        id="m-game"
        label="Game"
        help={lockGameAndMode ? "Players have registered: game, kind and mode are locked" : undefined}
        errors={err("game")}
      >
        <NativeSelect
          {...ids("game")}
          disabled={lockGameAndMode}
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
      <FormField id="m-kind" label="Kind" errors={err("kind")}>
        <NativeSelect
          {...ids("kind")}
          disabled={lockGameAndMode}
          value={v.kind}
          onChange={(e) => set("kind", e.target.value as MatchFormValues["kind"])}
        >
          <option value="SCRIM">Scrim</option>
          <option value="TOURNAMENT">Tournament match</option>
        </NativeSelect>
      </FormField>
      <FormField id="m-mode" label="Mode" help={capacityText(v.game, v.mode)} errors={err("mode")}>
        <NativeSelect
          {...ids("mode")}
          disabled={lockGameAndMode}
          value={v.mode}
          onChange={(e) => onModeChange(e.target.value as MatchMode)}
        >
          {MODES_FOR_GAME[v.game].map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField
        id="m-minSlots"
        label={`Minimum ${slotUnit(v.mode)} to play`}
        help="Fewer confirmed when registration closes = match cancelled and refunded automatically (0 = never)"
        errors={err("minSlots")}
      >
        <Input
          {...ids("minSlots")}
          type="number"
          inputMode="numeric"
          min={0}
          max={maxSlotsFor(v.game, v.mode)}
          value={v.minSlots}
          onChange={(e) => set("minSlots", e.target.value)}
        />
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="m-title" label="Title" errors={err("title")}>
          <Input
            {...ids("title")}
            value={v.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="BGMI Night Squad Scrim"
          />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField id="m-description" label="Description (optional)" errors={err("description")}>
          <Textarea
            {...ids("description")}
            rows={3}
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField id="m-startsAt" label="Start time (IST)" errors={err("startsAt")}>
          <IstDateTimePicker
            id="m-startsAt"
            label="Start time"
            value={v.startsAt}
            invalid={!!err("startsAt")}
            onChange={(val) => set("startsAt", val)}
          />
        </FormField>
      </div>
      <FormField
        id="m-closeOffsetMinutes"
        label="Registration closes (minutes before start)"
        help="Default 30 minutes"
        errors={err("closeOffsetMinutes")}
      >
        <Input
          {...ids("closeOffsetMinutes")}
          type="number"
          inputMode="numeric"
          min={0}
          value={v.closeOffsetMinutes}
          onChange={(e) => set("closeOffsetMinutes", e.target.value)}
        />
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="m-registrationOpensAt"
          label="Registration opens automatically at (IST, optional)"
          help="Leave empty to open registration manually"
          errors={err("registrationOpensAt")}
        >
          <IstDateTimePicker
            id="m-registrationOpensAt"
            label="Registration opens"
            optional
            value={v.registrationOpensAt}
            invalid={!!err("registrationOpensAt")}
            onChange={(val) => set("registrationOpensAt", val)}
          />
        </FormField>
      </div>
      <FormField id="m-streamUrl" label="Stream URL (optional)" errors={err("streamUrl")}>
        <Input
          {...ids("streamUrl")}
          type="url"
          placeholder="https://youtube.com/..."
          value={v.streamUrl}
          onChange={(e) => set("streamUrl", e.target.value)}
        />
      </FormField>
      <FormField
        id="m-entryFee"
        label="Entry fee (₹)"
        help={
          paymentsEnabled
            ? "0 = free entry"
            : "Payments are disabled; paid matches stay hidden from registration"
        }
        errors={err("entryFee")}
      >
        <Input
          {...ids("entryFee")}
          inputMode="decimal"
          value={v.entryFee}
          onChange={(e) => set("entryFee", e.target.value)}
        />
      </FormField>
      <FormField id="m-prize" label="Prize (₹)" errors={err("prize")}>
        <Input
          {...ids("prize")}
          inputMode="decimal"
          value={v.prize}
          onChange={(e) => set("prize", e.target.value)}
        />
      </FormField>
      <FormField
        id="m-tournamentId"
        label="Tournament (optional)"
        help={
          headToHead
            ? `${MODE_LABEL[v.mode]} tournaments are brackets: their matches are created from the tournament page`
            : `${GAME_CONFIG[v.game].name} ${MODE_LABEL[v.mode]} tournaments with lobby matches`
        }
        errors={err("tournamentId")}
      >
        <NativeSelect
          {...ids("tournamentId")}
          value={v.tournamentId}
          onChange={(e) => set("tournamentId", e.target.value)}
        >
          <option value="">None</option>
          {tournaments
            .filter((t) => t.game === v.game && t.mode === v.mode)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </NativeSelect>
      </FormField>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : matchId ? "Save changes" : "Create match"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
