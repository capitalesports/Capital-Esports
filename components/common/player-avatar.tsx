import Image from "next/image";
import { cn } from "@/lib/utils";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Round avatar with a thin gold ring; falls back to initials. */
export function PlayerAvatar({
  name,
  src,
  size = 32,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-gold/50 bg-surface text-gold relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border text-[0.65rem] font-semibold",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        // no-referrer: Google profile photos (lh3.googleusercontent.com) refuse requests that send
        // our site as the referrer.
        <Image
          src={src}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
          unoptimized
          referrerPolicy="no-referrer"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
