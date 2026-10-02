"use client";

import { useState } from "react";
import {
  banUserAction,
  mergeUsersAction,
  resetGameProfileAction,
  setUserDateOfBirthAction,
  setUserRoleAction,
  unbanUserAction,
} from "@/app/admin/users/actions";
import { FieldError } from "@/components/common/field-error";
import { FormField } from "@/components/common/form-field";
import { DobPicker } from "@/components/profile/dob-picker";
import { IstDateTimePicker } from "@/components/admin/ist-date-time-picker";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GAME_CONFIG, type Game } from "@/lib/games";

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="card-ds space-y-3 p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function BanControls({ userId, banned }: { userId: string; banned: boolean }) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const ban = useAction(banUserAction);
  const unban = useAction(unbanUserAction);
  if (banned) {
    return (
      <Box title="Ban">
        <Button variant="secondary" disabled={unban.pending} onClick={() => unban.run({ userId })}>
          Unban user
        </Button>
      </Box>
    );
  }
  return (
    <Box title="Ban">
      <p className="text-muted-foreground text-sm">
        Bans the account and blocks its email and every game ID from re-registering.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ban.run({ userId, reason, until: until || undefined });
        }}
      >
        <FormField id="ban-reason" label="Reason" errors={ban.fieldErrors.reason}>
          <Input id="ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <FormField
          id="ban-until"
          label="Until (IST, empty = permanent)"
          errors={ban.fieldErrors.until}
        >
          <IstDateTimePicker
            id="ban-until"
            label="Ban until"
            optional
            value={until}
            invalid={!!ban.fieldErrors.until}
            onChange={setUntil}
          />
        </FormField>
        <Button type="submit" variant="destructive" disabled={ban.pending}>
          Ban user
        </Button>
      </form>
    </Box>
  );
}

/** Support: correct a player's date of birth (players can't change it once saved). */
export function DobControls({
  userId,
  dateOfBirth,
}: {
  userId: string;
  dateOfBirth: string | null;
}) {
  const [dob, setDob] = useState(dateOfBirth ?? "");
  const { run, pending, fieldErrors } = useAction(setUserDateOfBirthAction);
  return (
    <Box title="Date of birth">
      <p className="text-muted-foreground text-sm">
        Players can&apos;t change it after saving; correct it here when they contact support.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ userId, dateOfBirth: dob });
        }}
      >
        <p id="dob-label" className="sr-only">
          Date of birth
        </p>
        <DobPicker value={dob} onChange={setDob} invalid={!!fieldErrors.dateOfBirth} />
        <FieldError id="admin-dob-error" messages={fieldErrors.dateOfBirth} />
        <Button type="submit" variant="secondary" disabled={pending || !dob || dob === dateOfBirth}>
          Save date of birth
        </Button>
      </form>
    </Box>
  );
}

export function RoleControls({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: string;
  isSelf: boolean;
}) {
  const [value, setValue] = useState(role);
  const { run, pending } = useAction(setUserRoleAction);
  return (
    <Box title="Role">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ userId, role: value });
        }}
      >
        <div className="grow">
          <FormField id="role" label="Role">
            <NativeSelect
              id="role"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isSelf}
            >
              <option value="PLAYER">Player</option>
              <option value="MODERATOR">Moderator</option>
              <option value="ADMIN">Admin</option>
            </NativeSelect>
          </FormField>
        </div>
        <Button type="submit" variant="secondary" disabled={pending || isSelf || value === role}>
          Save role
        </Button>
      </form>
      {isSelf ? (
        <p className="text-muted-foreground text-xs">You cannot change your own role.</p>
      ) : null}
    </Box>
  );
}

export function ResetGameProfileButton({ userId, game }: { userId: string; game: Game }) {
  const { run, pending } = useAction(resetGameProfileAction);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (confirm(`Remove this player's ${GAME_CONFIG[game].idLabel}?`))
          void run({ userId, game });
      }}
    >
      Reset
    </Button>
  );
}

export function MergeControls({ primaryId }: { primaryId: string }) {
  const [duplicateId, setDuplicateId] = useState("");
  const { run, pending, fieldErrors } = useAction(mergeUsersAction);
  return (
    <Box title="Merge a duplicate into this account">
      <p className="text-muted-foreground text-sm">
        Moves registrations, points, teams and missing game IDs from the duplicate, then
        soft-deletes it.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm("Merge the duplicate into this account? This cannot be undone."))
            void run({ primaryId, duplicateId });
        }}
      >
        <div className="grow">
          <FormField id="dup-id" label="Duplicate user ID" errors={fieldErrors.duplicateId}>
            <Input
              id="dup-id"
              value={duplicateId}
              onChange={(e) => setDuplicateId(e.target.value.trim())}
            />
          </FormField>
        </div>
        <Button type="submit" variant="secondary" disabled={pending || !duplicateId}>
          Merge
        </Button>
      </form>
    </Box>
  );
}
