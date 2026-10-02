import { IntentLink as Link } from "@/components/common/intent-link";
import { Button } from "@/components/ui/button";
import type { ArtworkName } from "@/lib/artwork";
import { Artwork } from "./artwork";

/** Empty state with an optional design artwork (empty-no-matches, empty-no-team, …) and a next action. */
export function EmptyState({
  title,
  description,
  action,
  art,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  art?: ArtworkName;
}) {
  return (
    <div className="card-ds flex flex-col items-center px-6 py-10 text-center">
      {art ? (
        <div className="relative mb-4 size-28">
          <Artwork name={art} fit="contain" sizes="112px" className="rounded-xl" />
        </div>
      ) : null}
      <p className="font-heading text-xl font-bold">{title}</p>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-md text-sm">{description}</p>
      ) : null}
      {action ? (
        <Button asChild className="mt-5">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}
