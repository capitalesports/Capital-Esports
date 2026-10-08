"use client";

import { useRouter } from "next/navigation";
import { GiftIcon } from "lucide-react";
import { redeemFreeSlotAction } from "@/app/(site)/scrims/[id]/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

/** Confirm a paid entry with a referral free slot instead of paying (DECISIONS M52). */
export function UseFreeSlotButton({ matchId, available }: { matchId: string; available: number }) {
  const router = useRouter();
  const { run, pending } = useAction(redeemFreeSlotAction);
  return (
    <Button
      type="button"
      variant="gold-outline"
      className="w-full"
      disabled={pending}
      onClick={async () => {
        if (!confirm("Use 1 free slot from your referral rewards for this entry?")) return;
        const r = await run({ matchId });
        if (r.ok) router.refresh();
      }}
    >
      <GiftIcon aria-hidden className="size-4" />
      {pending ? "Confirming…" : `Use a free slot (${available} left)`}
    </Button>
  );
}
