import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
  className,
  icon,
  tag,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Gold lucide icon before the title, as in the design's section headings. */
  icon?: React.ReactNode;
  /** Small uppercase note after the title, e.g. "Current season". */
  tag?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {icon ? <span className="text-gold [&_svg]:size-7">{icon}</span> : null}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {tag ? (
            <span className="font-heading text-muted-foreground text-sm tracking-wide uppercase">
              ({tag})
            </span>
          ) : null}
        </div>
        {description ? <p className="text-muted-foreground mt-1">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
