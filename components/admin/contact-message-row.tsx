"use client";

import { markContactHandledAction } from "@/app/admin/content/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { formatIST } from "@/lib/time";

export function ContactMessageRow({
  message,
}: {
  message: { id: string; name: string; contact: string; message: string; createdAt: string };
}) {
  const { run, pending } = useAction(markContactHandledAction);
  return (
    <li className="border-border space-y-2 rounded-lg border p-3 text-sm">
      <p>
        <strong>{message.name}</strong> · {message.contact} ·{" "}
        <span className="text-muted-foreground">{formatIST(new Date(message.createdAt))}</span>
      </p>
      <p className="whitespace-pre-wrap">{message.message}</p>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run({ id: message.id })}
      >
        Mark handled
      </Button>
    </li>
  );
}
