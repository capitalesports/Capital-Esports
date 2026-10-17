"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { BrandIcon } from "@/components/common/brand-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Remembered on this device once the player joined (or says they already have). */
export const WHATSAPP_JOINED_KEY = "whatsapp-community-joined";

export function rememberJoined() {
  try {
    localStorage.setItem(WHATSAPP_JOINED_KEY, "1");
  } catch {}
}

/**
 * Before registering (DECISIONS M70): join our WhatsApp community — room details and updates go out
 * there 30 minutes before each match. "Join now" opens the community, then "Continue to register";
 * "Already joined" goes straight on. Shown until the player has done either on this device.
 */
export function WhatsappGate({
  open,
  onOpenChange,
  whatsappUrl,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsappUrl: string;
  onContinue: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const proceed = () => {
    rememberJoined();
    onOpenChange(false);
    onContinue();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrandIcon platform="WHATSAPP" className="text-success size-6" />
            Join our WhatsApp community
          </DialogTitle>
          <DialogDescription>
            All match updates go out on our WhatsApp community first: room ID and password,
            reminders 30 minutes before the start, timing changes and results. Join before you
            register so you don&apos;t miss your match.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Button asChild className="w-full">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
            >
              <BrandIcon platform="WHATSAPP" className="size-5" /> Join now
            </a>
          </Button>
          {opened ? (
            <Button type="button" variant="gold-outline" className="w-full" onClick={proceed}>
              <CheckIcon aria-hidden /> I joined, continue to register
            </Button>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={proceed}>
              <CheckIcon aria-hidden /> Already joined, continue
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
