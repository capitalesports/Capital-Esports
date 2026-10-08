import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { GameBadge } from "@/components/game/game-badge";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getReferrerDetail } from "@/server/services/referrals";
import { formatINR } from "@/lib/money";
import { referralPeriodFrom } from "@/lib/referral";
import { formatDateIST, formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Referrals" };

export default async function AdminReferrerPage({
  params,
  searchParams,
}: PageProps<"/admin/referrals/[id]">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/referrals/${id}`);
  const period = referralPeriodFrom((await searchParams).period);
  const { referrer, players } = await getReferrerDetail(toActor(user), {
    referrerId: id,
    period,
  });
  return (
    <>
      <PageHeader
        title={`Referred by ${referrer.name}`}
        description={`Code ${referrer.referralCode ?? "—"} · ${players.length} player(s) joined`}
      />
      <Link
        href={period === "all" ? "/admin/referrals" : `/admin/referrals?period=${period}`}
        className="min-h-tap text-gold mb-4 inline-flex items-center text-sm hover:underline"
      >
        ← All referrers
      </Link>
      {players.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody has joined with this code yet.</p>
      ) : (
        <ul className="space-y-3">
          {players.map((p) => (
            <li key={p.userId} className="card-ds space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/players/${p.userId}`} className="font-semibold hover:underline">
                  {p.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  joined {p.joinedAt ? formatDateIST(p.joinedAt) : "—"}
                </span>
                <span className="ml-auto text-xs">
                  {p.slots} slot(s) · {p.paidSlots} paid · {formatINR(p.paidPaise)}
                </span>
              </div>
              {p.payments.length ? (
                <ul className="border-border space-y-1 border-t pt-2">
                  {p.payments.map((pay, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                      <GameBadge game={pay.match.game} />
                      <Link href={`/admin/matches/${pay.match.id}`} className="hover:underline">
                        {pay.match.title}
                      </Link>
                      <span className="text-muted-foreground">
                        {pay.paidAt ? formatIST(pay.paidAt) : ""}
                      </span>
                      <span className="ml-auto font-semibold">{formatINR(pay.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">No paid entries in this period.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
