import { Label } from "@/components/ui/label";
import { FieldError } from "./field-error";

/** Label + control + help + first error, wired with aria-describedby. */
export function FormField({
  id,
  label,
  help,
  errors,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {help}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} messages={errors} />
    </div>
  );
}
