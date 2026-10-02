import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { ReportResolver } from "@/components/admin/report-resolver";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listReports } from "@/server/services/reports";
import { isWithinDisputeWindow } from "@/lib/points";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const TABS = ["OPEN", "RESOLVED", "DISMISSED"] as const;

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const user = await requireStaffPage("/admin/reports");
  const tabParam = (await searchParams).status;
  const tab = TABS.find((t) => t === tabParam) ?? "OPEN";
  const reports = await listReports(toActor(user), tab);

  return (
    <>
      <PageHeader
        title="Reports & disputes"
        description="Player reports, result reports and disputes (within 2 hours of results)."
      />
      <nav aria-label="Report status" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/reports?status=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn(
              "min-h-tap inline-flex items-center rounded-full border px-4 text-sm",
              t === tab ? "bg-secondary" : "border-border text-muted-foreground",
            )}
          >
            {t.toLowerCase()}
          </Link>
        ))}
      </nav>
      {reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {tab.toLowerCase()} reports.</p>
      ) : null}
      <ul className="space-y-3">
        {reports.map((r) => (
          <li key={r.id} className="card-ds space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-semibold",
                  r.type === "DISPUTE" ? "bg-warning/20 text-warning" : "bg-muted",
                )}
              >
                {r.type}
              </span>
              <span className="text-muted-foreground">{formatIST(r.createdAt)}</span>
              <span>by {r.reporter.displayName ?? "Player"}</span>
              {r.targetUser ? (
                <span>
                  against{" "}
                  <Link className="underline" href={`/players/${r.targetUser.id}`}>
                    {r.targetUser.displayName ?? "Player"}
                  </Link>
                </span>
              ) : null}
              {r.match ? (
                <span>
                  on{" "}
                  <Link className="underline" href={`/admin/results/${r.match.id}`}>
                    {r.match.title}
                  </Link>
                  {r.type === "DISPUTE" &&
                  isWithinDisputeWindow(r.match.resultsApprovedAt, new Date())
                    ? " (window open)"
                    : ""}
                </span>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap">{r.reason}</p>
            {r.evidenceUrl ? (
              <a
                href={r.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary text-sm underline"
              >
                Evidence
              </a>
            ) : null}
            {r.status === "OPEN" ? (
              <ReportResolver reportId={r.id} />
            ) : (
              <p className="text-muted-foreground text-sm">Resolution: {r.resolution}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
