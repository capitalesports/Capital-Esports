import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { BrandLogo } from "@/components/layout/brand-logo";
import { requirePageUser } from "@/server/auth/guards";
import { canAccessAdminPath, sectionsForRole } from "@/lib/admin-nav";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: "Admin", template: `%s · Admin · ${SITE_NAME}` },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser("/admin");
  if (user.role === "PLAYER") notFound();
  // Hard 404 (before any streaming) when a moderator opens an admin-only section; pages re-check too.
  const pathname = (await headers()).get("x-pathname") ?? "/admin";
  if (!canAccessAdminPath(user.role, pathname)) notFound();
  const sections = sectionsForRole(user.role).map(({ href, label }) => ({ href, label }));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-border border-b">
        <div className="h-header flex items-center gap-4 px-4">
          <BrandLogo />
          <Link
            href="/admin"
            className="font-heading hover:text-gold text-lg font-bold tracking-wide uppercase"
          >
            Admin
          </Link>
          <span className="border-border text-muted-foreground rounded-md border px-2 py-0.5 text-xs">
            {user.role}
          </span>
          <Link
            href="/"
            className="min-h-tap text-muted-foreground hover:text-gold ml-auto inline-flex items-center text-sm"
          >
            View site
          </Link>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <aside className="lg:w-52 lg:shrink-0">
          <AdminNav sections={sections} />
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
