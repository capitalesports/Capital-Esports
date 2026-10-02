"use client";

import { Share2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Native share sheet on phones; falls back to copying the link (desktop). Includes a WhatsApp link. */
export function ShareButton({
  text,
  url,
  label = "Share",
}: {
  text: string;
  url: string;
  label?: string;
}) {
  const absolute =
    typeof window === "undefined" ? url : new URL(url, window.location.origin).toString();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={async () => {
          const full = new URL(url, window.location.origin).toString();
          if (navigator.share) {
            await navigator.share({ text, url: full }).catch(() => {});
            return;
          }
          await navigator.clipboard?.writeText(`${text} ${full}`);
          toast.success("Link copied");
        }}
      >
        <Share2Icon aria-hidden /> {label}
      </Button>
      <Button asChild variant="ghost">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${absolute}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
      </Button>
    </div>
  );
}
