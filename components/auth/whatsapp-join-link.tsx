import { MessageCircleIcon } from "lucide-react";

/** "Join our WhatsApp channel" under the login and sign-up forms (admin-set social link). */
export function WhatsAppJoinLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <p className="mt-6 text-center text-sm">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-h-tap text-primary inline-flex items-center gap-2 underline-offset-4 hover:underline"
      >
        <MessageCircleIcon aria-hidden className="size-4" />
        Join our WhatsApp channel
      </a>
    </p>
  );
}
