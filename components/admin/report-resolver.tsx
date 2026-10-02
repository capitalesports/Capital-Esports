"use client";

import { useState } from "react";
import { resolveReportAction } from "@/app/admin/reports/actions";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReportResolver({ reportId }: { reportId: string }) {
  const [resolution, setResolution] = useState("");
  const { run, pending, fieldErrors } = useAction(resolveReportAction);
  return (
    <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => e.preventDefault()}>
      <div className="min-w-48 grow">
        <Input
          aria-label="Resolution note"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="What did you do?"
        />
        {fieldErrors.resolution ? (
          <p className="text-destructive text-xs">{fieldErrors.resolution[0]}</p>
        ) : null}
      </div>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => run({ reportId, status: "RESOLVED", resolution })}
      >
        Resolve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run({ reportId, status: "DISMISSED", resolution })}
      >
        Dismiss
      </Button>
    </form>
  );
}
