import { z } from "zod";
import { AppError } from "./errors";

/** Parse untrusted input or throw a VALIDATION AppError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const flat = z.flattenError(result.error);
  const fieldErrors = flat.fieldErrors as Record<string, string[]>;
  const first = flat.formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? "Invalid input";
  throw new AppError("VALIDATION", first, fieldErrors);
}

/** FormData -> plain object (last value wins; files kept as File). */
export function formDataToObject(form: FormData): Record<string, FormDataEntryValue> {
  const out: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of form.entries()) out[k] = v;
  return out;
}
