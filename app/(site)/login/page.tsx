import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { RelaunchNotice } from "@/components/auth/relaunch-notice";
import { WhatsAppJoinLink } from "@/components/auth/whatsapp-join-link";
import { PageHeader } from "@/components/common/page-header";
import { getCurrentUser } from "@/server/auth/session";
import { getSocialLinks } from "@/server/services/content";
import { showRelaunchNotice } from "@/lib/relaunch";
import { safeReturnTo } from "@/lib/validators";

export const metadata: Metadata = { title: "Login", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { returnTo } = await searchParams;
  const target = typeof returnTo === "string" ? returnTo : null;
  const [user, social] = await Promise.all([getCurrentUser(), getSocialLinks()]);
  if (user) redirect(safeReturnTo(target));
  const whatsapp = social.find((s) => s.platform === "WHATSAPP")?.url ?? null;
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="card-ds p-6 sm:p-8">
        <PageHeader
          className="pt-0"
          title="Login"
          description="Browse freely. Log in to register for matches, see room credentials and join a team."
        />
        {showRelaunchNotice() ? (
          <RelaunchNotice
            signupHref={target ? `/signup?returnTo=${encodeURIComponent(target)}` : "/signup"}
          />
        ) : null}
        <LoginForm returnTo={target} />
        <WhatsAppJoinLink url={whatsapp} />
      </div>
    </div>
  );
}
