import { cn } from "@/lib/utils";

/** Native <select> styled like the Input: best keyboard/mobile behaviour for simple choices. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-11 w-full rounded-lg border px-3 text-base outline-none focus-visible:ring-3 disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
