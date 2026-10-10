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

export default async function AdminPaymentsPage() {
  const user = await requireStaffPage("/admin/payments");
  const { waiting, decided } = await listManualPayments(toActor(user));
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Payment approvals"
        description="UPI payments players made to your QR. Check the money reached your account (match the amount and transaction ID in your UPI app), then approve. Only approved entries get their slot confirmed and the confirmation email."
      />
      <section aria-labelledby="waiting-h" className="space-y-3">
        <h2 id="waiting-h" className="text-lg font-semibold">
          Waiting for approval ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing waiting.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {waiting.map((p) => {
              const event = p.match.tournament?.title ?? p.match.title;
              const who =
                p.registration.team?.name ?? p.registration.teamName ?? p.user.displayName;
              const closed = now >= p.match.registrationClosesAt;
              return (
                <li key={p.id} className="card-ds space-y-3 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <GameBadge game={p.match.game} />
                    <Link
                      href={`/admin/matches/${p.match.id}`}
                      className="font-semibold hover:underline"
                    >
                      {event}
                    </Link>
                    <span className="text-gold ml-auto text-lg font-bold">
                      {formatINR(p.amountPaise)}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Player</dt>
                    <dd>{who ?? "Player"}</dd>
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
                      aria-label={`Open the payment screenshot from ${who ?? "the player"} full size`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.screenshotUrl}
                        alt=""
                        className="border-border max-h-72 rounded-lg border object-contain"
                      />
                    </a>
                  ) : null}
                  <ReviewControls
                    id={p.id}
                    label={`${who ?? "Player"}, ${formatINR(p.amountPaise)}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="decided-h" className="mt-10 space-y-3">
        <h2 id="decided-h" className="text-lg font-semibold">
          Recently decided
        </h2>
        {decided.length === 0 ? (
          <p className="text-muted-foreground text-sm">No decisions yet.</p>
        ) : (
          <ul className="space-y-2">
            {decided.map((p) => (
              <li key={p.id} className="card-ds flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className={p.status === "APPROVED" ? "text-success" : "text-destructive"}>
                  {p.status === "APPROVED" ? "Approved" : "Rejected"}
                </span>
                <span className="font-medium">
                  {p.registration.team?.name ?? p.registration.teamName ?? p.user.displayName}
                </span>
                <span className="text-muted-foreground">
                  {p.match.tournament?.title ?? p.match.title} · {formatINR(p.amountPaise)} ·{" "}
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
        )}
      </section>
    </>
  );
}
