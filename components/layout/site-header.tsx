import { IntentLink as Link } from "@/components/common/intent-link";
import { Suspense } from "react";
import { BellIcon } from "lucide-react";
import { BrandIcon } from "@/components/common/brand-icon";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "./brand-logo";
import { GameSwitcher } from "./game-switcher";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { UserMenu, type HeaderRole } from "./user-menu";

export interface HeaderUser {
  displayName: string | null;
  avatarUrl: string | null;
  role: HeaderRole;
  unread: number;
}

/**
 * Navbar per the designs: logo · links · Games/More · Login + Get Started (home-desktop.png), or,
 * logged in, a bell with an unread dot and the account menu (scrims-desktop.png). The design's
 * search box was removed at the owner's request (DECISIONS M21).
 */
/** WhatsApp community link next to the bell (DECISIONS M23, M24). */
function CommunityLink({ url }: { url: string }) {
  return (
    <Button asChild variant="ghost" className="px-2 sm:px-3">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <BrandIcon platform="WHATSAPP" className="text-success" />
        <span className="sr-only sm:not-sr-only">Community</span>
        <span className="sr-only"> (WhatsApp, opens in a new tab)</span>
      </a>
    </Button>
  );
}

export function SiteHeader({
  user,
  whatsappUrl = null,
}: {
  user: HeaderUser | null;
  /** The WhatsApp community link from Admin → Content → Social links. */
  whatsappUrl?: string | null;
}) {
  return (
    <header className="border-border bg-background sticky top-0 z-40 border-b">
      <a
        href="#main"
        className="focus:bg-gold focus:text-background sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="page-container h-header flex items-center gap-2">
        <BrandLogo />
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {whatsappUrl ? <CommunityLink url={whatsappUrl} /> : null}
          {user ? (
            <>
              <Button asChild variant="ghost" size="icon" className="relative">
                <Link
                  href="/notifications"
                  aria-label={
                    user.unread ? `Notifications, ${user.unread} unread` : "Notifications"
                  }
                >
                  <BellIcon aria-hidden />
                  {user.unread ? (
                    <span
                      aria-hidden
                      data-unread-dot
                      className="bg-destructive ring-background absolute top-2.5 right-2.5 size-2 rounded-full ring-2"
                    />
                  ) : null}
                </Link>
              </Button>
              <UserMenu
                name={user.displayName ?? "Player"}
                avatarUrl={user.avatarUrl}
                role={user.role}
              />
            </>
          ) : (
            <>
              <Button asChild variant="outline" className="hidden sm:inline-flex">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild variant="gold-outline">
                <Link href="/signup?returnTo=%2Fdashboard">Get Started</Link>
              </Button>
            </>
          )}
          <MobileNav />
        </div>
      </div>
      <Suspense fallback={null}>
        <GameSwitcher />
      </Suspense>
    </header>
  );
}
