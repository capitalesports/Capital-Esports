import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listReferrers } from "@/server/services/referrals";
import { formatINR } from "@/lib/money";
import {
  PERIOD_LABEL,
  REFERRAL_PERIODS,
  REFERRALS_PER_FREE_SLOT,
  referralPeriodFrom,
} from "@/lib/referral";
import { formatIST } from "@/lib/time";
import { chipClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Referrals" };

export default async function AdminReferralsPage({ searchParams }: PageProps<"/admin/referrals">) {
  const user = await requireStaffPage("/admin/referrals");
  const period = referralPeriodFrom((await searchParams).period);
  const rows = await listReferrers(toActor(user), { period });
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Who brought in which players, and how many slots (and paid entries) those players booked."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {REFERRAL_PERIODS.map((p) => (
            <Link
              key={p}
              href={p === "all" ? "/admin/referrals" : `/admin/referrals?period=${p}`}
              aria-current={p === period ? "page" : undefined}
              className={chipClass(p === period)}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </nav>
        <a
          href={`/admin/referrals/export?period=${period}`}
          className={cn(buttonVariants({ variant: "outline" }), "ml-auto")}
        >
          Download CSV
        </a>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">
        Joined counts every referred player; slots and paid entries count only those in the chosen
        period. Paid entries appear once payments are switched on.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No referrals yet.</p>
      ) : (
        <div className="card-ds overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead className="text-right">Joined</TableHead>
                <TableHead className="text-right">Booked a slot</TableHead>
                <TableHead className="text-right">Paid players</TableHead>
                <TableHead className="text-right">Slots</TableHead>
                <TableHead className="text-right">Paid slots</TableHead>
                <TableHead className="text-right">Entry fees</TableHead>
                <TableHead className="text-right">Free slots earned</TableHead>
                <TableHead>Last paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.referrerId}>
                  <TableCell>
                    <Link
                      href={`/admin/referrals/${r.referrerId}${period === "all" ? "" : `?period=${period}`}`}
                      className="text-gold font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.code ? (
                      <span className="text-muted-foreground block font-mono text-xs">
                        {r.code}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">{r.joined}</TableCell>
                  <TableCell className="text-right">{r.booked}</TableCell>
                  <TableCell className="text-right">{r.paidPlayers}</TableCell>
                  <TableCell className="text-right">{r.slots}</TableCell>
                  <TableCell className="text-right font-semibold">{r.paidSlots}</TableCell>
                  <TableCell className="text-right">{formatINR(r.paidPaise)}</TableCell>
                  <TableCell className="text-gold text-right font-semibold">
                    {Math.floor(r.paidPlayers / REFERRALS_PER_FREE_SLOT)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.lastPaidAt ? formatIST(r.lastPaidAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
