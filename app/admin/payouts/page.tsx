import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import {
  ApprovePayoutButton,
  ResolveFlagButton,
  RevealUpi,
  SeasonPrizeForm,
  SettlePayoutControls,
  SyncLedgerButton,
} from "@/components/admin/payout-controls";
import { MarkRefundedButton } from "@/components/admin/refund-controls";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
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
import { db } from "@/server/db";
import { payoutTwoStepThresholdPaise } from "@/server/env";
import { isManualPayout, listPayoutLedger, payoutSources } from "@/server/services/payouts";
import { listPendingRefunds } from "@/server/services/refunds";
import { maskEmail } from "@/lib/contact-display";
import { GAME_CONFIG } from "@/lib/games";
import { formatINR } from "@/lib/money";
import { isAdult, needsSecondApproval } from "@/lib/payments";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Prizes & payouts" };

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  PROCESSING: "Processing",
  SUCCESS: "Confirmed (paid)",
  FAILED: "Failed",
  REVERSED: "Reversed",
};

export default async function AdminPayoutsPage({ searchParams }: PageProps<"/admin/payouts">) {
  const user = await requireStaffPage("/admin/payouts");
  const includeVoided = (await searchParams).voided === "1";
  const threshold = payoutTwoStepThresholdPaise();
  const [ledger, seasons, flags, refunds] = await Promise.all([
    listPayoutLedger(toActor(user), { includeVoided }),
    db.season.findMany({
      where: { isActive: false },
      orderBy: { endsAt: "desc" },
      take: 12,
      select: { id: true, name: true, game: true },
    }),
    db.reconciliationFlag.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    listPendingRefunds(toActor(user)),
  ]);
  const sources = await payoutSources(ledger);
  // Everything not yet paid: waiting, failed, or being sent.
  const open = ledger.filter(
    (p) =>
      !p.voidedAt && (p.status === "PENDING" || p.status === "FAILED" || p.status === "PROCESSING"),
  );
  const openTotal = open.reduce((sum, p) => sum + p.amountPaise, 0);

  return (
    <>
      <PageHeader
        title="Prizes & payouts"
        description={`Ledger of winners and transfers. Payouts above ${formatINR(threshold)} need two different admins.`}
      >
        <SyncLedgerButton />
        <Button asChild variant="outline">
          <a href={`/admin/payouts/export${includeVoided ? "?voided=1" : ""}`}>Export CSV</a>
        </Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          <span className="font-semibold">{open.length}</span> to pay ·{" "}
          <span className="font-semibold">{formatINR(openTotal)}</span>
        </p>
        <Link
          href={includeVoided ? "/admin/payouts" : "/admin/payouts?voided=1"}
          className="min-h-tap text-muted-foreground inline-flex items-center hover:underline"
        >
          {includeVoided ? "Hide voided payouts" : "Show voided payouts"}
        </Link>
      </div>
      <div className="card-ds overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Winner</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.map((p) => {
              const m = p.user.payoutMethod;
              const twoStep = needsSecondApproval(p.amountPaise, threshold);
              const awaitingSecond = twoStep && p.status === "PENDING" && !!p.approvedById;
              const waiting = !p.voidedAt && (p.status === "PENDING" || p.status === "FAILED");
              // Our side of a hand-paid prize: Waiting / Processing / Confirmed (DECISIONS M26).
              const settleable =
                waiting || (!p.voidedAt && p.status === "PROCESSING" && isManualPayout(p));
              const canApprove = waiting && !!m && isAdult(p.user.dateOfBirth);
              const winner = p.user.displayName ?? "Player";
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/admin/users/${p.user.id}`} className="hover:underline">
                      {p.user.displayName ?? "Player"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    #{p.place} ·{" "}
                    {p.matchId ? (
                      <Link href={`/admin/matches/${p.matchId}`} className="hover:underline">
                        {sources.get(p.id)}
                      </Link>
                    ) : (
                      sources.get(p.id)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatINR(p.amountPaise)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m ? (
                      m.kind === "UPI" ? (
                        settleable ? (
                          <RevealUpi payoutId={p.id} masked={m.vpaMasked ?? "UPI"} />
                        ) : (
                          m.vpaMasked
                        )
                      ) : (
                        `••••${m.accountLast4} ${m.ifsc}`
                      )
                    ) : (
                      <span className="text-warning">
                        No UPI yet: the winner adds it on their profile (they were emailed)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.voidedAt
                      ? `voided · ${p.voidReason ?? ""}`
                      : (PAYOUT_STATUS_LABEL[p.status] ?? p.status.toLowerCase())}
                    {!p.voidedAt && p.manualReference ? " · paid by hand" : ""}
                    {awaitingSecond ? " · awaiting 2nd approval" : ""}
                    {p.failureReason ? ` · ${p.failureReason}` : ""}
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.manualReference ?? p.cfTransferId ?? p.transferId ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      {canApprove ? (
                        <ApprovePayoutButton
                          payoutId={p.id}
                          label={
                            awaitingSecond
                              ? "Second approval"
                              : p.status === "FAILED"
                                ? "Retry"
                                : "Approve"
                          }
                        />
                      ) : null}
                      {settleable ? (
                        <SettlePayoutControls payoutId={p.id} winner={winner} status={p.status} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {ledger.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          No prizes yet. Publish tournament winners, then add them here.
        </p>
      ) : null}

      <section aria-labelledby="season-prize-h" className="mt-10 space-y-3">
        <h2 id="season-prize-h" className="text-lg font-semibold">
          Season prizes
        </h2>
        <p className="text-muted-foreground text-sm">
          Verify the season&apos;s top 3 manually, then add their prizes.
        </p>
        <SeasonPrizeForm
          seasons={seasons.map((s) => ({
            id: s.id,
            label: `${GAME_CONFIG[s.game].name} — ${s.name}`,
          }))}
        />
      </section>

      <section aria-labelledby="refunds-h" className="mt-10 space-y-3">
        <h2 id="refunds-h" className="text-lg font-semibold">
          Entry-fee refunds to make ({refunds.length})
        </h2>
        <p className="text-muted-foreground text-sm">
          Refunds are sent to Razorpay automatically and retried every night. If one stays here,
          refund it by hand (Razorpay dashboard → Transactions → Payments → search the payment ID →
          Issue Refund), then mark it refunded.
        </p>
        {refunds.length === 0 ? (
          <p className="text-muted-foreground text-sm">No refunds waiting.</p>
        ) : (
          <ul className="space-y-3">
            {refunds.map((r) => {
              const who = r.user.displayName ?? "(no name)";
              return (
                <li key={r.id} className="card-ds space-y-2 p-4 text-sm">
                  <p>
                    <span className="font-medium">{who}</span>
                    {r.user.email ? ` · ${maskEmail(r.user.email)}` : ""} ·{" "}
                    <span className="text-gold font-semibold">{formatINR(r.amountPaise)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {r.match.title} · {r.refundReason ?? "Refund"} · since {formatIST(r.updatedAt)}
                  </p>
                  <p className="text-muted-foreground">
                    Razorpay payment ID:{" "}
                    <span className="text-foreground font-mono">{r.cfPaymentId ?? "—"}</span>
                  </p>
                  <MarkRefundedButton
                    paymentId={r.id}
                    about={`${who} (${formatINR(r.amountPaise)})`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="recon-h" className="mt-10 space-y-3">
        <h2 id="recon-h" className="text-lg font-semibold">
          Reconciliation flags
        </h2>
        {flags.length === 0 ? (
          <p className="text-muted-foreground text-sm">No mismatches found by the nightly check.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {formatIST(f.createdAt)} · {f.kind} {f.entityId}: ours {f.ours}, provider{" "}
                  {f.theirs} (applied)
                </span>
                <ResolveFlagButton flagId={f.id} about={`${f.kind} ${f.entityId}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
