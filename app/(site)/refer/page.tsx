import type { Metadata } from "next";
import { GiftIcon } from "lucide-react";
import { BrandIcon } from "@/components/common/brand-icon";
import { PageHeader } from "@/components/common/page-header";
import { ShareReferral } from "@/components/referral/share-referral";
import { requirePageUser } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { getMyReferrals } from "@/server/services/referrals";
import {
  FREE_SLOT_MAX_FEE_PAISE,
  REFERRAL_MIN_QUALIFYING_FEE_PAISE,
  referralPath,
  REFERRALS_PER_FREE_SLOT,
} from "@/lib/referral";
import { siteUrl } from "@/lib/site";
import { formatDateIST } from "@/lib/time";

export const metadata: Metadata = { title: "Refer friends", robots: { index: false } };

export default async function ReferPage() {
  const user = await requirePageUser("/refer");
  const mine = await getMyReferrals(toActor(user));
  const link = `${siteUrl()}${referralPath(mine.code)}`;
  const stats = [
    { label: "Joined with your code", value: mine.joined },
    { label: "Booked a slot", value: mine.booked },
    { label: "Played a paid match", value: mine.paidPlayers },
  ];
  return (
    <div className="mx-auto max-w-2xl py-6">
      <PageHeader
        icon={<GiftIcon aria-hidden />}
        title="Refer friends"
        description="Share your link or code. Friends who create an account with it are counted as your referrals."
      />
      <section
        aria-labelledby="reward-h"
        className="card-ds border-gold bg-gold/10 mb-6 space-y-3 p-4 sm:p-6"
      >
        <h2 id="reward-h" className="font-heading text-gold text-2xl font-extrabold uppercase">
          Refer {REFERRALS_PER_FREE_SLOT} friends, get 1 free slot
        </h2>
        <p className="text-sm">
          When {REFERRALS_PER_FREE_SLOT} players who joined with your code each book a{" "}
          <strong>paid</strong> slot, you get <strong>1 free slot</strong> for any paid scrim or
          tournament. Every {REFERRALS_PER_FREE_SLOT} more earns another.
        </p>
        <p className="text-muted-foreground text-xs">
          A paid slot counts from ₹{REFERRAL_MIN_QUALIFYING_FEE_PAISE / 100} entry. A free slot
          covers entries up to ₹{FREE_SLOT_MAX_FEE_PAISE / 100}. Fake or duplicate accounts are
          removed and their rewards cancelled.
        </p>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">Progress to your next free slot</span>
            <span className="font-semibold">
              {mine.rewards.towardNext} / {REFERRALS_PER_FREE_SLOT}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Progress to your next free slot"
            aria-valuemin={0}
            aria-valuemax={REFERRALS_PER_FREE_SLOT}
            aria-valuenow={mine.rewards.towardNext}
            className="bg-background h-3 overflow-hidden rounded-full"
          >
            <div
              className="bg-gold h-full rounded-full transition-all"
              style={{ width: `${(mine.rewards.towardNext / REFERRALS_PER_FREE_SLOT) * 100}%` }}
            />
          </div>
        </div>
        <p className="text-sm">
          {mine.rewards.available > 0 ? (
            <span className="text-success font-semibold">
              You have {mine.rewards.available} free slot{mine.rewards.available === 1 ? "" : "s"}.
              Register for a paid match and choose “Use a free slot”.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Free slots earned: {mine.rewards.earned} · used: {mine.rewards.used}
            </span>
          )}
        </p>
      </section>

      <section aria-labelledby="share-h" className="card-ds space-y-4 p-4 sm:p-6">
        <h2 id="share-h" className="sr-only">
          Your referral code and link
        </h2>
        <ShareReferral
          code={mine.code}
          link={link}
          whatsappIcon={<BrandIcon platform="WHATSAPP" className="size-4" />}
        />
        <p className="text-muted-foreground text-xs">
          Your friend can open the link, or type your code on the sign-up page. It counts only for
          new accounts, once per player.
        </p>
      </section>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card-ds flex flex-col-reverse p-3 text-center">
            <dt className="text-muted-foreground text-xs">{s.label}</dt>
            <dd className="font-heading text-gold text-3xl font-extrabold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="joined-h" className="mt-8 space-y-3">
        <h2 id="joined-h" className="text-lg font-semibold">
          Players you referred
        </h2>
        {mine.players.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody has joined with your code yet. Share it with your squad.
          </p>
        ) : (
          <ul className="space-y-2">
            {mine.players.map((p, i) => (
              <li key={i} className="card-ds flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground text-xs">
                  joined {p.joinedAt ? formatDateIST(p.joinedAt) : ""}
                </span>
                <span className="ml-auto text-xs">
                  {p.paid ? (
                    <span className="text-success">Played a paid match</span>
                  ) : p.booked ? (
                    <span className="text-gold">Booked a slot</span>
                  ) : (
                    <span className="text-muted-foreground">Not played yet</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
