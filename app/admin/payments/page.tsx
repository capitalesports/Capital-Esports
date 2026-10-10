import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listManualPayments } from "@/server/services/manual-payments";
import { UPI_APP_LABEL, type UpiAppId } from "@/lib/manual-payments";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = { title: "Payment approvals" };

type Payments = Awaited<ReturnType<typeof listManualPayments>>;
type Payment = Payments["waiting"][number];

interface EventGroup {
  key: string;
  title: string;
  game: Payment["match"]["game"];
  href: string;
  isTournament: boolean;
  waiting: Payment[];
  decided: Payment[];
}

/** One section per tournament (or scrim): its waiting payments first, then its decided ones. */
function groupByEvent({ waiting, decided }: Payments): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  const groupOf = (p: Payment) => {
    const t = p.match.tournament;
    const key = t ? `t:${t.id}` : `m:${p.match.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: t?.title ?? p.match.title,
        game: p.match.game,
        href: t ? `/admin/tournaments/${t.id}` : `/admin/matches/${p.match.id}`,
        isTournament: !!t,
        waiting: [],
        decided: [],
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const p of waiting) groupOf(p).waiting.push(p);
  for (const p of decided) groupOf(p).decided.push(p);
  // Events with payments to check first (oldest waiting first), then the rest.
  return [...groups.values()].sort((a, b) => {
    if (!!a.waiting.length !== !!b.waiting.length) return a.waiting.length ? -1 : 1;
    const at = a.waiting[0]?.submittedAt?.getTime() ?? 0;
    const bt = b.waiting[0]?.submittedAt?.getTime() ?? 0;
    return at - bt;
  });
}

const nameOf = (p: Payment) =>
  p.registration.team?.name ?? p.registration.teamName ?? p.user.displayName ?? "Player";

export default async function AdminPaymentsPage() {
  const user = await requireStaffPage("/admin/payments");
  const payments = await listManualPayments(toActor(user));
  const groups = groupByEvent(payments);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Payment approvals"
        description="UPI payments players made to your QR, one section per tournament. Check the money reached your account (match the amount and transaction ID in your UPI app), then approve. Only approved entries get their slot confirmed and the confirmation email."
      />
      <p className="mb-4 text-sm">
        <span className="text-gold font-semibold">{payments.waiting.length} waiting</span>
        <span className="text-muted-foreground">
          {" "}
          across {groups.filter((g) => g.waiting.length).length} tournament(s)
        </span>
      </p>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No UPI payments yet.</p>
      ) : null}
      {groups.length ? (
        <nav aria-label="Jump to tournament" className="mb-6 flex flex-wrap gap-2">
          {groups.map((g) => (
            <a
              key={g.key}
              href={`#${g.key}`}
              className="border-border hover:border-gold min-h-tap inline-flex items-center gap-2 rounded-lg border px-3 text-sm"
            >
              {g.title}
              {g.waiting.length ? (
                <span className="bg-gold text-background rounded-full px-2 text-xs font-bold">
                  {g.waiting.length}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="space-y-8">
        {groups.map((g) => {
          const approved = g.decided.filter((p) => p.status === "APPROVED");
          const collected = approved.reduce((sum, p) => sum + p.amountPaise, 0);
          return (
            <section
              key={g.key}
              id={g.key}
              aria-labelledby={`${g.key}-h`}
              className="card-ds scroll-mt-20 space-y-4 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <GameBadge game={g.game} />
                <h2 id={`${g.key}-h`} className="text-lg font-semibold">
                  <Link href={g.href} className="hover:underline">
                    {g.title}
                  </Link>
                </h2>
                <span className="text-muted-foreground text-xs">
                  {g.isTournament ? "Tournament" : "Scrim"}
                </span>
                <span className="text-muted-foreground ml-auto text-sm">
                  <span className={g.waiting.length ? "text-gold font-semibold" : ""}>
                    {g.waiting.length} waiting
                  </span>{" "}
                  · {approved.length} approved · {formatINR(collected)} collected
                </span>
              </div>
              {g.waiting.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing waiting.</p>
              ) : (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {g.waiting.map((p) => {
                    const who = nameOf(p);
                    const closed = now >= p.match.registrationClosesAt;
                    return (
                      <li
                        key={p.id}
                        className="border-border space-y-3 rounded-lg border p-4 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{who}</span>
                          <span className="text-gold ml-auto text-lg font-bold">
                            {formatINR(p.amountPaise)}
                          </span>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <dt className="text-muted-foreground">Paid with</dt>
                          <dd>{p.app ? UPI_APP_LABEL[p.app as UpiAppId] : "—"}</dd>
                          <dt className="text-muted-foreground">Transaction ID</dt>
                          <dd className="font-mono break-all">{p.transactionId}</dd>
                          <dt className="text-muted-foreground">Submitted</dt>
                          <dd>{p.submittedAt ? formatIST(p.submittedAt) : "—"}</dd>
                          <dt className="text-muted-foreground">Registration closes</dt>
                          <dd className={closed ? "text-destructive" : ""}>
                            {formatIST(p.match.registrationClosesAt)}
                            {closed ? " (closed)" : ""}
                          </dd>
                        </dl>
                        {p.screenshotUrl ? (
                          <a
                            href={p.screenshotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                            aria-label={`Open the payment screenshot from ${who} full size`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.screenshotUrl}
                              alt=""
                              className="border-border max-h-72 rounded-lg border object-contain"
                            />
                          </a>
                        ) : null}
                        <ReviewControls id={p.id} label={`${who}, ${formatINR(p.amountPaise)}`} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {g.decided.length ? (
                <details>
                  <summary className="min-h-tap text-muted-foreground hover:text-foreground flex cursor-pointer items-center text-sm">
                    Approved / rejected ({g.decided.length})
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {g.decided.map((p) => (
                      <li
                        key={p.id}
                        className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                      >
                        <span
                          className={p.status === "APPROVED" ? "text-success" : "text-destructive"}
                        >
                          {p.status === "APPROVED" ? "Approved" : "Rejected"}
                        </span>
                        <span className="font-medium">{nameOf(p)}</span>
                        <span className="text-muted-foreground">
                          {formatINR(p.amountPaise)} ·{" "}
                          <span className="font-mono">{p.transactionId}</span>
                        </span>
                        <span className="text-muted-foreground ml-auto text-xs">
                          {p.reviewedAt ? formatIST(p.reviewedAt) : ""} ·{" "}
                          {p.reviewedBy?.displayName ?? "Admin"}
                          {p.rejectReason ? ` · ${p.rejectReason}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
