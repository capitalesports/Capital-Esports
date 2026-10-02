"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  bulkCloneMatchAction,
  cancelMatchAction,
  cloneMatchAction,
  promoteRegistrationAction,
  removeRegistrationAction,
  setRoomCredentialsAction,
  transitionMatchAction,
} from "@/app/admin/matches/actions";
import { FormField } from "@/components/common/form-field";
import { IstDateTimePicker } from "@/components/admin/ist-date-time-picker";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Game } from "@/lib/games";
import { roomCodeLabel, roomNeedsPassword } from "@/lib/room-rules";
import {
  canSetRoomCredentials,
  canTransition,
  MANUAL_TRANSITIONS,
  TRANSITION_ACTION_LABEL,
  type MatchStatus,
} from "@/lib/match-state";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-ds space-y-3 p-4" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function StatusControls({ matchId, status }: { matchId: string; status: MatchStatus }) {
  const { run, pending } = useAction(transitionMatchAction);
  const next = MANUAL_TRANSITIONS.filter((to) => to !== "CANCELLED" && canTransition(status, to));
  return (
    <Section title="Status">
      {next.length ? (
        <div className="flex flex-wrap gap-2">
          {next.map((to) => (
            <Button key={to} disabled={pending} onClick={() => run({ matchId, to })}>
              {TRANSITION_ACTION_LABEL[to]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No manual status changes available from this state.
        </p>
      )}
    </Section>
  );
}

export function RoomCredentialsForm({
  matchId,
  game,
  status,
  hasCredentials,
}: {
  matchId: string;
  game: Game;
  status: MatchStatus;
  hasCredentials: boolean;
}) {
  const [roomId, setRoomId] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const { run, pending, fieldErrors } = useAction(setRoomCredentialsAction);
  // Valorant: one room code, no password (DECISIONS M22).
  const withPassword = roomNeedsPassword(game);
  const codeLabel = roomCodeLabel(game);
  if (!canSetRoomCredentials(status)) return null;
  return (
    <Section title={withPassword ? "Room credentials" : "Room code"}>
      <p className="text-muted-foreground text-sm">
        {hasCredentials ? "Already set. Saving replaces it." : "Not set yet."} Confirmed players
        see it as soon as you save (on their dashboard and the match page) and get a notification.
        Nobody else can see it.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(
            withPassword ? { matchId, roomId, roomPassword } : { matchId, roomId },
          );
          if (r.ok) {
            setRoomId("");
            setRoomPassword("");
          }
        }}
      >
        <FormField id="room-id" label={codeLabel} errors={fieldErrors.roomId}>
          <Input
            id="room-id"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            autoComplete="off"
          />
        </FormField>
        {withPassword ? (
          <FormField id="room-password" label="Room password" errors={fieldErrors.roomPassword}>
            <Input
              id="room-password"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              autoComplete="off"
            />
          </FormField>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {withPassword ? "Save room credentials" : "Save room code"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function CloneControls({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [startsAt, setStartsAt] = useState("");
  const [days, setDays] = useState("3");
  const clone = useAction(cloneMatchAction);
  const bulk = useAction(bulkCloneMatchAction);
  return (
    <Section title="Clone">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await clone.run({ matchId, startsAt });
          if (r.ok) router.push(`/admin/matches/${r.data}`);
        }}
      >
        <div className="w-full">
          <FormField id="clone-startsAt" label="Clone to (IST)" errors={clone.fieldErrors.startsAt}>
            <IstDateTimePicker
              id="clone-startsAt"
              label="Clone start"
              value={startsAt}
              invalid={!!clone.fieldErrors.startsAt}
              onChange={setStartsAt}
            />
          </FormField>
        </div>
        <Button type="submit" variant="secondary" disabled={clone.pending}>
          Clone
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void bulk.run({ matchId, days: Number(days) });
        }}
      >
        <div className="grow">
          <FormField
            id="clone-days"
            label="Same match daily for the next N days"
            errors={bulk.fieldErrors.days}
          >
            <Input
              id="clone-days"
              type="number"
              min={1}
              max={14}
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </FormField>
        </div>
        <Button type="submit" variant="secondary" disabled={bulk.pending}>
          Clone daily
        </Button>
      </form>
    </Section>
  );
}

/** Per-entry moderator actions in the registrations table. */
export function RegistrationActions({
  matchId,
  registrationId,
  name,
  canRemove,
  canPromote,
}: {
  matchId: string;
  registrationId: string;
  name: string;
  canRemove: boolean;
  canPromote: boolean;
}) {
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const remove = useAction(removeRegistrationAction);
  const promote = useAction(promoteRegistrationAction);
  if (!canRemove && !canPromote) return null;
  const reasonId = `remove-reason-${registrationId}`;
  if (removing) {
    return (
      <form
        className="flex min-w-56 flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await remove.run({ matchId, registrationId, reason });
          if (r.ok) setRemoving(false);
        }}
      >
        <FormField id={reasonId} label={`Why remove ${name}?`} errors={remove.fieldErrors.reason}>
          <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="destructive" disabled={remove.pending}>
            Remove entry
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(false)}>
            Keep
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canPromote ? (
        <Button
          size="sm"
          variant="outline"
          disabled={promote.pending}
          aria-label={`Promote ${name}`}
          onClick={() => promote.run({ matchId, registrationId })}
        >
          Promote
        </Button>
      ) : null}
      {canRemove ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={`Remove ${name}`}
          onClick={() => setRemoving(true)}
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}

export function CancelControls({ matchId, status }: { matchId: string; status: MatchStatus }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { run, pending, fieldErrors } = useAction(cancelMatchAction);
  if (!canTransition(status, "CANCELLED")) return null;
  return (
    <Section title="Cancel match">
      <p className="text-muted-foreground text-sm">
        All registrations are cancelled and any entry fees are refunded automatically.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirming) {
            setConfirming(true);
            return;
          }
          await run({ matchId, reason });
          setConfirming(false);
        }}
      >
        <FormField id="cancel-reason" label="Reason" errors={fieldErrors.reason}>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Not enough players"
          />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={pending}>
            {confirming ? "Confirm cancellation" : "Cancel match"}
          </Button>
          {confirming ? (
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep match
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}
