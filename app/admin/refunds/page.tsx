import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { MarkRefundedButton } from "@/components/admin/refund-controls";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listRefunds, UNREVIEWED_REFUND } from "@/server/services/refunds";
import { UPI_APP_LABEL, type UpiAppId } from "@/lib/manual-payments";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Refunds" };

type Refunds = Awaited<ReturnType<typeof listRefunds>>;
type Refund = Refunds["pending"][number];

/** Pending refunds grouped by tournament (or scrim), in the order they were queued. */
function byEvent(rows: Refund[]) {
  const groups = new Map<
    string,
    { key: string; title: string; game: Refund["match"]["game"]; href: string; rows: Refund[] }
  >();
  for (const r of rows) {
    const t = r.match.tournament;
    const key = t ? `t:${t.id}` : `m:${r.match.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: t?.title ?? r.match.title,
        game: r.match.game,
        href: t ? `/admin/tournaments/${t.id}` : `/admin/matches/${r.match.id}`,
        rows: [],
      };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  return [...groups.values()];
}

const nameOf = (r: Refund) => r.user.displayName ?? "(no name)";

export default async function AdminRefundsPage() {
  const user = await requireStaffPage("/admin/refunds");
  const { pending, done } = await listRefunds(toActor(user));
  const total = pending.reduce((sum, r) => sum + r.amountPaise, 0);
  return (
    <>
      <PageHeader
        title="Refunds"
        description="Entry fees to give back. When a match or tournament is cancelled, every paid entry lands here automatically. Send the amount back to the player by UPI, then press Mark refunded."
      />
      <p className="mb-6 text-sm">
        <span className="text-gold font-semibold">
          {pending.length} to refund · {formatINR(total)}
        </span>
      </p>

      {pending.length === 0 ? (
        <p className="text-muted-foreground text-sm">No refunds waiting.</p>
      ) : (
        <div className="space-y-8">
          {byEvent(pending).map((g) => (
            <section key={g.key} aria-labelledby={`${g.key}-h`} className="card-ds space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <GameBadge game={g.game} />
                <h2 id={`${g.key}-h`} className="text-lg font-semibold">
                  <Link href={g.href} className="hover:underline">
                    {g.title}
                  </Link>
                </h2>
                <span className="text-muted-foreground ml-auto text-sm">
                  {g.rows.length} to refund ·{" "}
                  {formatINR(g.rows.reduce((sum, r) => sum + r.amountPaise, 0))}
                </span>
              </div>
              <ul className="grid gap-3 lg:grid-cols-2">
                {g.rows.map((r) => {
                  const unchecked = r.refundReason?.startsWith(UNREVIEWED_REFUND) ?? false;
                  return (
                    <li
                      key={r.id}
                      className="border-border space-y-3 rounded-lg border p-4 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="bg-destructive/15 text-destructive rounded-full px-2 py-0.5 text-xs font-bold">
                          Refund
                        </span>
                        <span className="font-semibold">{nameOf(r)}</span>
                        <span className="text-gold ml-auto text-lg font-bold">
                          {formatINR(r.amountPaise)}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">Phone</dt>
                        <dd>{r.user.phone ?? "—"}</dd>
                        <dt className="text-muted-foreground">Email</dt>
                        <dd className="break-all">{r.user.email ?? "—"}</dd>
                        <dt className="text-muted-foreground">Paid with</dt>
                        <dd>{r.upiApp ? UPI_APP_LABEL[r.upiApp as UpiAppId] : "—"}</dd>
                        <dt className="text-muted-foreground">Transaction ID</dt>
                        <dd className="font-mono break-all">{r.cfPaymentId ?? "—"}</dd>
                        <dt className="text-muted-foreground">Queued</dt>
                        <dd>{formatIST(r.updatedAt)}</dd>
                      </dl>
                      {unchecked ? (
                        <p className="text-gold text-xs">
                          This UPI payment was never approved: check the transaction ID reached your
                          account before refunding.
                        </p>
                      ) : null}
                      <MarkRefundedButton
                        paymentId={r.id}
                        about={`${nameOf(r)} (${formatINR(r.amountPaise)})`}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section aria-labelledby="done-h" className="mt-10 space-y-3">
        <h2 id="done-h" className="text-lg font-semibold">
          Refunded
        </h2>
        {done.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {done.map((r) => (
              <li key={r.id} className="card-ds flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="text-success font-semibold">Refunded</span>
                <span className="font-medium">{nameOf(r)}</span>
                <span className="text-muted-foreground">
                  {r.match.tournament?.title ?? r.match.title} · {formatINR(r.amountPaise)} ·{" "}
                  <span className="font-mono">{r.cfPaymentId ?? "—"}</span>
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {r.refundedAt ? formatIST(r.refundedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
