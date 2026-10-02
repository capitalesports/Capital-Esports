import { cn } from "./utils";

/** Filter chip (design: "All Games · Free Fire · BGMI · Valorant"); gold when active. */
export function chipClass(active: boolean) {
  return cn(
    "inline-flex min-h-tap items-center rounded-lg border px-5 text-sm font-medium transition-colors",
    active
      ? "border-gold bg-gold/10 text-gold"
      : "border-border bg-surface text-foreground hover:border-gold",
  );
}
