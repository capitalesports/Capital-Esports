import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { analyticsSummary } from "@/server/services/analytics";
import { db } from "@/server/db";
import { sectionsForRole } from "@/lib/admin-nav";
import { formatINR } from "@/lib/money";
import { addMinutes, formatIST, startOfIstDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

interface Stat {
  label: string;
  value: string | number;
  href: string;
  detail?: string;
  /** Needs attention: highlighted when the count is above zero. */
  alert?: boolean;
}

/** Counts that need a moderator/admin today. Admin-only cards are left out for moderators. */
async function dashboardStats(isAdmin: boolean, now: Date): Promise<Stat[]> {
  const dayStart = startOfIstDay(now);
  const dayEnd = startOfIstDay(now, 1);
  const soon = addMinutes(now, 120);
  const [today, open, pendingResults, reports, noRoom] = await Promise.all([
    db.match.count({ where: { startsAt: { gte: dayStart, lt: dayEnd }, isEntryList: false } }),
    db.match.count({ where: { status: "REGISTRATION_OPEN" } }),
    db.match.count({ where: { status: "RESULTS_PENDING" } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.match.count({
      where: {
        isEntryList: false,
        roomId: null,
        status: { in: ["UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] },
        startsAt: { gte: dayStart, lt: dayEnd, lte: soon },
      },
    }),
  ]);
  const stats: Stat[] = [
    { label: "Open reports & disputes", value: reports, href: "/admin/reports", alert: true },
    {
      label: "Matches awaiting results",
      value: pendingResults,
      href: "/admin/results",
      alert: true,
    },
    {
      label: "Starting within 2h without room ID",
      value: noRoom,
      href: "/admin/matches?status=REGISTRATION_CLOSED",
      alert: true,
    },
    { label: "Matches today (IST)", value: today, href: "/admin/matches" },
    { label: "Registration open", value: open, href: "/admin/matches?status=REGISTRATION_OPEN" },
  ];
  if (!isAdmin) return stats;
  const [payouts, flags, messages, deletions] = await Promise.all([
    db.payout.aggregate({
      where: { status: "PENDING", voidedAt: null },
      _count: true,
      _sum: { amountPaise: true },
    }),
    db.reconciliationFlag.count({ where: { resolvedAt: null } }),
    db.contactMessage.count({ where: { handled: false } }),
    db.accountDeletionRequest.count({ where: { status: "PENDING" } }),
  ]);
  return [
    ...stats.slice(0, 3),
    {
      label: "Pending payouts",
      value: payouts._count,
      detail: formatINR(payouts._sum.amountPaise ?? 0),
      href: "/admin/payouts",
      alert: true,
    },
    { label: "Reconciliation flags", value: flags, href: "/admin/payouts#recon-h", alert: true },
    {
      label: "Unhandled contact messages",
      value: messages,
      href: "/admin/content#messages",
      alert: true,
    },
    {
      label: "Account deletion requests",
      value: deletions,
      href: "/admin/deletion-requests",
      alert: true,
    },
    ...stats.slice(3),
  ];
}

/** The cron job leaves an audit row (actor: system) for every automatic status change. */
async function lastCronRun() {
  const row = await db.auditLog.findFirst({
    where: { actorId: null, action: { startsWith: "match.status.auto" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export default async function AdminHomePage() {
  const user = await requireStaffPage("/admin");
  if (user.role === "PLAYER") return null;
  const now = new Date();
  const [stats, cronAt] = await Promise.all([
    dashboardStats(user.role === "ADMIN", now),
    lastCronRun(),
  ]);
  const analytics = user.role === "ADMIN" ? await analyticsSummary(toActor(user)) : null;
  return (
    <>
      <PageHeader
        title="Admin"
        description={`Signed in as ${user.displayName ?? user.email ?? user.phone ?? "admin"} (${user.role.toLowerCase()}).`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={cn(
              "card-ds-interactive p-4",
              s.alert && Number(s.value) > 0 ? "border-gold" : undefined,
            )}
          >
            <p className="text-muted-foreground text-sm">{s.label}</p>
            <p className="text-3xl font-bold">
              {s.value}
              {s.detail ? (
                <span className="text-muted-foreground ml-2 text-base font-normal">{s.detail}</span>
              ) : null}
            </p>
          </Link>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 text-sm">
        Last automatic status change (cron):{" "}
        {cronAt ? formatIST(cronAt) : "unknown — no automatic changes recorded yet"}
      </p>
      {analytics ? (
        <section aria-labelledby="analytics-h" className="mt-8 grid gap-4 lg:grid-cols-2">
          <h2 id="analytics-h" className="sr-only">
            Analytics (last 7 days)
          </h2>
          <div className="card-ds p-4">
            <p className="text-muted-foreground text-sm">Page views, last 7 days</p>
            <p className="text-3xl font-bold">{analytics.views}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {analytics.topPaths.map((p) => (
                <li key={p.path} className="flex justify-between gap-2">
                  <span className="truncate">{p.path}</span>
                  <span className="text-muted-foreground">{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-ds p-4">
            <p className="text-muted-foreground text-sm">Funnel (new players, last 7 days)</p>
            <ol className="mt-2 space-y-2">
              {analytics.funnel.map((f, i) => {
                const first = analytics.funnel[0]!.users || 1;
                return (
                  <li key={f.name} className="text-sm">
                    <div className="flex justify-between">
                      <span>{["Logged in", "Completed profile", "First registration"][i]}</span>
                      <span className="font-semibold">
                        {f.users} ({Math.round((f.users / first) * 100)}%)
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-2 rounded">
                      <div
                        className="bg-primary h-2 rounded"
                        style={{ width: `${Math.round((f.users / first) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ) : null}
      <h2 className="mt-8 mb-2 font-semibold">Sections</h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {sectionsForRole(user.role).map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="min-h-tap border-border hover:bg-accent flex items-center rounded-lg border px-4"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
