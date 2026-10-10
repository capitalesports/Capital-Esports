"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, KeyRoundIcon, SendIcon } from "lucide-react";
import { setRoomCredentialsAction } from "@/app/admin/matches/actions";
import { IntentLink as Link } from "@/components/common/intent-link";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/lib/ui";

export interface TeamCodeRow {
  id: string;
  /** "Round 1 · Match 3" / "Match 2 · Lobby 1". */
  label: string;
  startsLabel: string;
  teams: string[];
  roomId: string | null;
  roomPassword: string | null;
  sent: boolean;
  /** Finished or cancelled: no code needed any more. */
  done: boolean;
}

type Filter = "pending" | "sent" | "all";
const PAGE = 20;

/**
 * Admin (DECISIONS M60): send the room / team code to one matchup (or one lobby) at a time. Only
 * the teams in that match see it on their dashboard and match page, and they get a notification.
 */
export function TeamCodesPanel({
  rows,
  needsPassword,
}: {
  rows: TeamCodeRow[];
  needsPassword: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const pending = rows.filter((r) => !r.done && !r.sent).length;
  const sent = rows.filter((r) => r.sent).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "pending" && (r.done || r.sent)) return false;
      if (filter === "sent" && !r.sent) return false;
      return (
        !q || r.teams.some((t) => t.toLowerCase().includes(q)) || r.label.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, query]);

  return (
    <section aria-labelledby="codes-h" className="card-ds space-y-3 p-4">
      <h2 id="codes-h" className="flex items-center gap-2 text-lg font-semibold">
        <KeyRoundIcon aria-hidden className="text-gold size-5" /> Team codes
      </h2>
      <p className="text-muted-foreground text-sm">
        Send the code to one match at a time. Only the teams in that match see it (dashboard and
        match page) and get a notification. {sent} sent · {pending} waiting.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["pending", `Not sent (${pending})`],
            ["sent", `Sent (${sent})`],
            ["all", `All (${rows.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={chipClass(filter === key)}
            onClick={() => {
              setFilter(key);
              setShown(PAGE);
            }}
          >
            {label}
          </button>
        ))}
        <Input
          type="search"
          aria-label="Search team"
          placeholder="Search team"
          className="max-w-56"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
        />
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {visible.slice(0, shown).map((r) => (
            <TeamCodeItem key={r.id} row={r} needsPassword={needsPassword} />
          ))}
        </ul>
      )}
      {visible.length > shown ? (
        <Button type="button" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({visible.length - shown} left)
        </Button>
      ) : null}
    </section>
  );
}

function TeamCodeItem({ row, needsPassword }: { row: TeamCodeRow; needsPassword: boolean }) {
  const router = useRouter();
  const [roomId, setRoomId] = useState(row.roomId ?? "");
  const [roomPassword, setRoomPassword] = useState(row.roomPassword ?? "");
  const { run, pending, fieldErrors } = useAction(setRoomCredentialsAction);
  const vs = row.teams.length ? row.teams.join(" vs ") : "No teams";

  return (
    <li className="border-border rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{row.teams.length === 2 ? vs : `${row.teams.length} teams`}</p>
        <p className="text-muted-foreground text-xs">
          <Link href={`/admin/matches/${row.id}`} className="hover:text-gold underline">
            {row.label}
          </Link>{" "}
          · {row.startsLabel}
        </p>
      </div>
      {row.teams.length > 2 ? <p className="text-muted-foreground mt-1 text-xs">{vs}</p> : null}
      {row.done ? (
        <p className="text-muted-foreground mt-2 text-sm">Match finished.</p>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-start gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({
              matchId: row.id,
              roomId,
              ...(needsPassword ? { roomPassword } : {}),
            });
            if (r.ok) router.refresh();
          }}
        >
          <Input
            aria-label={`${needsPassword ? "Room ID" : "Team code"} for ${vs}`}
            placeholder={needsPassword ? "Room ID" : "Team code"}
            className="max-w-48"
            value={roomId}
            aria-invalid={!!fieldErrors.roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          {needsPassword ? (
            <Input
              aria-label={`Password for ${vs}`}
              placeholder="Password"
              className="max-w-40"
              value={roomPassword}
              aria-invalid={!!fieldErrors.roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
            />
          ) : null}
          <Button type="submit" disabled={pending || !roomId.trim() || row.teams.length === 0}>
            <SendIcon aria-hidden /> {row.sent ? "Update & resend" : "Send to these teams"}
          </Button>
          {row.sent ? (
            <span className="text-success min-h-tap inline-flex items-center gap-1 text-sm">
              <CheckCircle2Icon aria-hidden className="size-4" /> Sent
            </span>
          ) : null}
        </form>
      )}
    </li>
  );
}
