"use client";

import { useRef } from "react";
import Image from "next/image";
import { uploadAvatarAction } from "@/app/(site)/profile/actions";
import { downscaleImage } from "@/components/common/resize-image";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";

export function AvatarForm({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction(uploadAvatarAction);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("avatar", await downscaleImage(file, 512, 200_000), "avatar");
    await run(form);
    e.target.value = "";
  }

  return (
    <div className="flex items-center gap-4">
      <div className="bg-muted relative size-20 overflow-hidden rounded-full">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            fill
            sizes="80px"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="text-muted-foreground flex size-full items-center justify-center text-2xl font-bold"
            aria-hidden
          >
            {name.slice(0, 1).toUpperCase() || "?"}
          </span>
        )}
      </div>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          id="avatar"
          aria-label="Upload avatar image"
          tabIndex={-1}
          onChange={onChange}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? "Uploading…" : avatarUrl ? "Change avatar" : "Upload avatar"}
        </Button>
        <p className="text-muted-foreground mt-1 text-xs">
          Optional. PNG, JPEG, WebP or GIF, up to 2 MB.
        </p>
      </div>
    </div>
  );
}
