"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

type Result<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Run a server action with pending state, a toast for every outcome and field errors for forms.
 */
export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<Result<T>>) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function run(...args: A): Promise<Result<T>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await action(...args);
        if (result.ok) {
          setFieldErrors({});
          if (result.message) toast.success(result.message);
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
        resolve(result);
      });
    });
  }

  return { run, pending, fieldErrors };
}
