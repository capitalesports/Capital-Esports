"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon } from "lucide-react";
import {
  reopenRegistrationAction,
  setRegistrationWindowAction,
} from "@/app/admin/tournaments/actions";
import { IstDateTimePicker } from "@/components/admin/ist-date-time-picker";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

/**
 * Admin: when the tournament's registration opens and closes (DECISIONS M57), separate from the
 * tournament's own start time.
 */
export function RegistrationWindowBox({
  tournamentId,
  status,
  opensAt,
  closesAt,
  opensLabel,
  closesLabel,
  startsLabel,
  reopenBlocker,
}: {
  tournamentId: string;
  /** The sign-up list's status. */
  status: string;
  /** IST datetime-local values. */
  opensAt: string;
  closesAt: string;
  opensLabel: string | null;
  closesLabel: string;
  startsLabel: string;
  /** Closed: why it can't be reopened (null = it can). */
  reopenBlocker: string | null;
}) {
  const router = useRouter();
  const [opens, setOpens] = useState(opensAt);
  const [closes, setCloses] = useState(closesAt);
  const { run, pending, fieldErrors } = useAction(setRegistrationWindowAction);
  const notOpenYet = status === "UPCOMING";
  const open = status === "REGISTRATION_OPEN";
  const closed = !notOpenYet && !open;

  return (
    <section aria-labelledby="regwin-h" className="card-ds space-y-3 p-4">
      <h2 id="regwin-h" className="flex items-center gap-2 font-semibold">
        <CalendarClockIcon aria-hidden className="text-gold size-5" />
        Registration
      </h2>
      <p className="text-sm" role="status">
        {open ? (
          <span className="text-success font-semibold">Open now</span>
        ) : notOpenYet ? (
          <span className="text-gold font-semibold">
            Not open yet{opensLabel ? `: opens ${opensLabel}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground font-semibold">Closed</span>
        )}
        <span className="text-muted-foreground">
          {" "}
          · closes {closesLabel} · tournament starts {startsLabel}
        </span>
      </p>
      {closed ? (
        <ReopenForm tournamentId={tournamentId} blocker={reopenBlocker} />
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({ tournamentId, opensAt: open ? "" : opens, closesAt: closes });
            if (r.ok) router.refresh();
          }}
        >
          {notOpenYet ? (
            <FormField
              id="rw-opens"
              label="Registration opens (IST)"
              help="Leave empty to open it as soon as you save"
              errors={fieldErrors.opensAt}
            >
              <IstDateTimePicker
                id="rw-opens"
                label="Registration opens"
                value={opens}
                optional
                invalid={!!fieldErrors.opensAt}
                onChange={setOpens}
              />
            </FormField>
          ) : null}
          <FormField
            id="rw-closes"
            label="Registration closes (IST)"
            help="Lobbies or the bracket are drawn at this time. It must be before the tournament starts."
            errors={fieldErrors.closesAt}
          >
            <IstDateTimePicker
              id="rw-closes"
              label="Registration closes"
              value={closes}
              invalid={!!fieldErrors.closesAt}
              onChange={setCloses}
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            {notOpenYet && !opens ? "Save and open registration now" : "Save registration times"}
          </Button>
        </form>
      )}
    </section>
  );
}

/** Closed by mistake: open it again until a new closing time (DECISIONS M61). */
function ReopenForm({ tournamentId, blocker }: { tournamentId: string; blocker: string | null }) {
  const router = useRouter();
  const [closes, setCloses] = useState("");
  const { run, pending, fieldErrors } = useAction(reopenRegistrationAction);
  if (blocker) {
    return (
      <p className="text-muted-foreground text-sm">
        Registration has closed; lobbies or the bracket are drawn. {blocker}
      </p>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ tournamentId, closesAt: closes });
        if (r.ok) router.refresh();
      }}
    >
      <p className="text-muted-foreground text-sm">
        Closed by mistake? Open it again: the drawn bracket or lobbies (and any codes sent to them)
        are removed and drawn again at the new closing time. Every sign-up stays.
      </p>
      <FormField
        id="rw-reopen"
        label="New closing time (IST)"
        help="Must be before the tournament starts"
        errors={fieldErrors.closesAt}
      >
        <IstDateTimePicker
          id="rw-reopen"
          label="New closing time"
          value={closes}
          invalid={!!fieldErrors.closesAt}
          onChange={setCloses}
        />
      </FormField>
      <Button type="submit" disabled={pending || !closes}>
        Reopen registration
      </Button>
    </form>
  );
}
