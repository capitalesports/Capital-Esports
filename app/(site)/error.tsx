"use client";

import { ErrorView } from "@/components/common/error-view";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView reset={reset} digest={error.digest} />;
}
