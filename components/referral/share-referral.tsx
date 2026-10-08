"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, Share2Icon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="flex items-center gap-2">
        <code className="border-border bg-background min-h-tap flex flex-1 items-center truncate rounded-lg border px-3 font-mono text-sm">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked: the value stays visible to copy by hand.
            }
          }}
        >
          {copied ? (
            <CheckIcon aria-hidden className="size-4" />
          ) : (
            <CopyIcon aria-hidden className="size-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** The player's referral code and link, with copy, WhatsApp and native share (DECISIONS M52). */
export function ShareReferral({
  code,
  link,
  whatsappIcon,
}: {
  code: string;
  link: string;
  /** Rendered on the server (BrandIcon), so simple-icons stays out of the client bundle. */
  whatsappIcon: ReactNode;
}) {
  const message = `Join me on Capital Esports for Free Fire, BGMI and Valorant scrims and tournaments: ${link} (referral code ${code})`;
  return (
    <div className="space-y-4">
      <CopyRow label="Your code" value={code} />
      <CopyRow label="Your link" value={link} />
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          {whatsappIcon}
          Share on WhatsApp
        </a>
        <Button
          type="button"
          variant="gold-outline"
          onClick={() => {
            if (navigator.share) void navigator.share({ text: message }).catch(() => {});
            else void navigator.clipboard?.writeText(message).catch(() => {});
          }}
        >
          <Share2Icon aria-hidden className="size-4" />
          Share
        </Button>
      </div>
    </div>
  );
}
