import "server-only";
import { unstable_rethrow } from "next/navigation";
import { isAppError, type ErrorCode } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      code: ErrorCode | "INTERNAL";
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Run a server action body and convert failures into a serialisable result for the client.
 * Next.js control-flow errors (redirect, notFound) are re-thrown.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
  message?: string,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    unstable_rethrow(e);
    if (isAppError(e))
      return { ok: false, code: e.code, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
  }
}
