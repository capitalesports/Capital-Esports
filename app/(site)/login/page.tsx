import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageCircleIcon } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { PageHeader } from "@/components/common/page-header";
import { getCurrentUser } from "@/server/auth/session";
import { getSocialLinks } from "@/server/services/content";
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
          description="Browse freely. Log in with Google or your phone to register for matches, see room credentials and join a team."
        />
        <LoginForm returnTo={target} />
        {whatsapp ? (
          <p className="mt-6 text-center text-sm">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-tap text-primary inline-flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <MessageCircleIcon aria-hidden className="size-4" />
              Join our WhatsApp channel
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
