"use client";

import { IntentLink as Link } from "@/components/common/intent-link";
import { Button } from "@/components/ui/button";

export function ErrorView({ reset, digest }: { reset: () => void; digest?: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center" role="alert">
      <p className="text-primary text-6xl font-extrabold">500</p>
      <h1 className="mt-4 text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        The server hit a snag loading this page. Try again; if it keeps happening, contact support.
      </p>
      {digest ? <p className="text-muted-foreground mt-2 text-xs">Reference: {digest}</p> : null}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
