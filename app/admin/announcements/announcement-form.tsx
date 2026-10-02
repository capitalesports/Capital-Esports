"use client";

import { useState } from "react";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GAME_LIST } from "@/lib/games";
import { sendAnnouncementAction } from "./actions";

const EMPTY = { title: "", body: "", link: "", audience: "ALL" };

export function AnnouncementForm() {
  const [v, setV] = useState(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const { run, pending, fieldErrors } = useAction(sendAnnouncementAction);
  const audience =
    v.audience === "ALL"
      ? "every player"
      : `${GAME_LIST.find((g) => g.id === v.audience)?.name ?? ""} players`;
  const aria = (k: string) => ({
    id: `an-${k}`,
    "aria-invalid": !!fieldErrors[k],
    "aria-describedby": `an-${k}-help an-${k}-error`,
  });
  return (
    <form
      aria-label="New announcement"
      className="card-ds grid max-w-3xl gap-4 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirming) {
          setConfirming(true);
          return;
        }
        const r = await run(v);
        setConfirming(false);
        if (r.ok) setV(EMPTY);
      }}
    >
      <FormField id="an-title" label="Title" errors={fieldErrors.title}>
        <Input
          {...aria("title")}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
        />
      </FormField>
      <FormField id="an-body" label="Message" help="Up to 500 characters" errors={fieldErrors.body}>
        <Textarea
          {...aria("body")}
          rows={4}
          value={v.body}
          onChange={(e) => setV({ ...v, body: e.target.value })}
        />
      </FormField>
      <FormField
        id="an-link"
        label="Link (optional)"
        help="A site path like /tournaments or a full https:// link"
        errors={fieldErrors.link}
      >
        <Input
          {...aria("link")}
          value={v.link}
          onChange={(e) => setV({ ...v, link: e.target.value })}
        />
      </FormField>
      <FormField
        id="an-audience"
        label="Send to"
        help="Game audiences are players who added a game ID for that game"
        errors={fieldErrors.audience}
      >
        <NativeSelect
          {...aria("audience")}
          value={v.audience}
          onChange={(e) => setV({ ...v, audience: e.target.value })}
        >
          <option value="ALL">All players</option>
          {GAME_LIST.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} players
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : confirming ? `Confirm: send to ${audience}` : "Send announcement"}
        </Button>
        {confirming ? (
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Back
          </Button>
        ) : null}
      </div>
    </form>
  );
}
