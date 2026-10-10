import { z } from "zod";
import { AppError } from "./errors";

/**
 * Remove NUL characters from every string in the input, however deeply nested. Postgres can't store
 * them, so a "%00" anywhere in a form field would otherwise crash the request with a 500.
 */
export function stripNulls(input: unknown, depth = 0): unknown {
  if (typeof input === "string")
    return input.includes("\u0000") ? input.replace(/\u0000/g, "") : input;
  if (depth > 20 || input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((v) => stripNulls(v, depth + 1));
  if (Object.getPrototypeOf(input) !== Object.prototype) return input;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, stripNulls(v, depth + 1)]),
  );
}

/** Parse untrusted input or throw a VALIDATION AppError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(stripNulls(input));
  if (result.success) return result.data;
  const flat = z.flattenError(result.error);
  const fieldErrors = flat.fieldErrors as Record<string, string[]>;
  const first = flat.formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? "Invalid input";
  throw new AppError("VALIDATION", first, fieldErrors);
}
