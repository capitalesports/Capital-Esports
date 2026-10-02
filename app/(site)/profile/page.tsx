import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { LogoutButton } from "@/components/auth/logout-button";
import { Artwork } from "@/components/common/artwork";
import { PageHeader } from "@/components/common/page-header";
import { AvatarForm } from "@/components/profile/avatar-form";
import { ContactDetails } from "@/components/profile/contact-details";
import { DeletionRequestPanel } from "@/components/profile/deletion-request-panel";
import { PayoutMethodForm } from "@/components/profile/payout-method-form";
import { ProfileDetailsForm } from "@/components/profile/profile-details-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { getMyPendingDeletionRequest } from "@/server/services/account-deletion";
import { MINOR_PAYOUT_MESSAGE } from "@/server/services/payouts";
import { maskEmail, maskPhone } from "@/lib/contact-display";
import { isAdult } from "@/lib/payments";
import { isProfileComplete } from "@/lib/profile";
import { formatIST } from "@/lib/time";
import { safeReturnTo } from "@/lib/validators";

export const metadata: Metadata = { title: "Profile", robots: { index: false } };

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await requirePageUser("/profile");
  const sp = await searchParams;
  const returnTo = typeof sp.returnTo === "string" ? safeReturnTo(sp.returnTo) : null;
  const missing = typeof sp.missing === "string" ? sp.missing : null;
  const complete = isProfileComplete(user);
  const dob = user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null;
  const deletionRequest = await getMyPendingDeletionRequest(user.id);
  const payoutMethod = await db.payoutMethod.findUnique({
    where: { userId: user.id },
    select: {
      kind: true,
      accountHolderName: true,
      // The owner's own full UPI ID, for the show/hide toggle on this page only.
      vpa: true,
      vpaMasked: true,
      accountLast4: true,
      ifsc: true,
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Your profile"
        description={`Logged in as ${user.email ? maskEmail(user.email) : user.phone ? maskPhone(user.phone) : "you"}`}
      >
        <LogoutButton />
      </PageHeader>

      {missing ? (
        <Alert className="mb-6" role="status">
          <AlertDescription>Before you can register, add: {missing}.</AlertDescription>
        </Alert>
      ) : !complete ? (
        <div className="card-ds mb-6 flex items-center gap-4 p-4" role="status">
          <div className="relative size-16 shrink-0">
            <Artwork name="empty-profile" fit="contain" sizes="64px" className="rounded-lg" />
          </div>
          <p className="text-sm">
            Complete your profile to register for matches: add your display name, date of birth and
            a verified email (match updates are sent by email). Your game ID is asked for when you
            register for that game&apos;s first match.
          </p>
        </div>
      ) : null}

      {complete && returnTo ? (
        <Button asChild className="mb-6">
          <Link href={returnTo}>Continue</Link>
        </Button>
      ) : null}

      <section aria-labelledby="details-heading" className="card-ds space-y-4 p-5">
        <h2 id="details-heading" className="text-lg font-semibold">
          Details
        </h2>
        <AvatarForm avatarUrl={user.avatarUrl} name={user.displayName ?? ""} />
        <ProfileDetailsForm displayName={user.displayName} dateOfBirth={dob} />
      </section>

      {/* Right after the details: the email is required to register (DECISIONS M12). */}
      <section aria-labelledby="contact-heading" className="card-ds mt-10 space-y-4 p-5">
        <h2 id="contact-heading" className="text-lg font-semibold">
          Login &amp; contact
        </h2>
        <p className="text-muted-foreground text-sm">
          Only you can see these. Tap the eye to show them; they are never shown on your public
          profile.
        </p>
        <ContactDetails
          phone={user.phone}
          email={user.emailVerifiedAt ? user.email : null}
          emailOptIn={user.emailOptIn}
        />
      </section>

      <section aria-labelledby="payout-heading" className="card-ds mt-10 space-y-4 p-5">
        <h2 id="payout-heading" className="text-lg font-semibold">
          Prize payouts
        </h2>
        <PayoutMethodForm
          saved={payoutMethod}
          adult={isAdult(user.dateOfBirth)}
          minorMessage={MINOR_PAYOUT_MESSAGE}
          hasDateOfBirth={!!user.dateOfBirth}
        />
      </section>

      <section
        aria-labelledby="delete-heading"
        className="card-ds border-destructive/40 mt-10 space-y-4 p-5"
      >
        <h2 id="delete-heading" className="text-lg font-semibold">
          Delete account
        </h2>
        <DeletionRequestPanel
          requestedAt={deletionRequest ? formatIST(deletionRequest.createdAt) : null}
        />
      </section>
    </div>
  );
}
