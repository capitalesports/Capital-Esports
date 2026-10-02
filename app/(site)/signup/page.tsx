import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { WhatsAppJoinLink } from "@/components/auth/whatsapp-join-link";
import { PageHeader } from "@/components/common/page-header";
import { getCurrentUser } from "@/server/auth/session";
import { getSocialLinks } from "@/server/services/content";
import { safeReturnTo } from "@/lib/validators";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
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
          title="Create account"
          description="Join to register for matches, see room credentials and build your team."
        />
        <SignupForm returnTo={target} />
        <WhatsAppJoinLink url={whatsapp} />
      </div>
    </div>
  );
}
