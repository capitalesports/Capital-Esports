"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type RoomResult =
  | { visible: true; roomId: string; roomPassword: string | null }
  | { visible: false; reason: "NOT_CONFIRMED" | "NOT_SET" | "ENDED" };

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="bg-muted flex items-center justify-between gap-2 rounded-lg px-3 py-2">
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="font-mono text-lg font-semibold" data-testid={testId}>
          {value}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          toast.success(`${label} copied`);
        }}
      >
        <CopyIcon aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Room ID + password for confirmed players, shown as soon as staff share them (DECISIONS M20).
 * Fetched from the server (never embedded in the page) and refreshed every 30 s, so a new or
 * changed room shows up without reloading.
 */
export function RoomPanel({ matchId }: { matchId: string }) {
  const [result, setResult] = useState<RoomResult | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/matches/${matchId}/room`, { cache: "no-store" });
    if (res.ok) setResult((await res.json()) as RoomResult);
  }, [matchId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  return (
    <section aria-labelledby="room-heading" className="card-ds space-y-3 p-4">
      <h2 id="room-heading" className="font-semibold">
        Room details
      </h2>
      {result?.visible ? (
        <div className="space-y-2">
          {/* Valorant: a single room code, no password (DECISIONS M22). */}
          <CopyField
            label={result.roomPassword === null ? "Room code" : "Room ID"}
            value={result.roomId}
            testId="room-room-id"
          />
          {result.roomPassword !== null ? (
            <CopyField label="Password" value={result.roomPassword} testId="room-password" />
          ) : null}
          <p className="text-muted-foreground text-xs">
            Only for you. Do not share these on WhatsApp or anywhere else.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {result === null
            ? "Loading…"
            : result.reason === "ENDED"
              ? "This match is over."
              : "The host hasn't shared the room yet. It shows up here as soon as they do."}
        </p>
      )}
    </section>
  );
}
