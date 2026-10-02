import { IconSprite } from "@/components/common/icon-sprite";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/server/auth/session";
import { getActiveSponsors, getSocialLinks } from "@/server/services/content";
import { unreadCount } from "@/server/services/inbox";
import { artworkSrc, artworkWebpFor } from "@/lib/artwork";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [user, socialLinks, sponsors] = await Promise.all([
    getCurrentUser(),
    getSocialLinks(),
    getActiveSponsors(),
  ]);
  const unread = user ? await unreadCount(user.id) : 0;
  // Page texture: WebP (≈18 KB at 1280 px) with the PNG as fallback, via CSS image-set().
  const textureWebp = artworkWebpFor("texture-dark", 1280, 1);
  const texturePng = artworkSrc("texture-dark");
  const texture =
    textureWebp && texturePng
      ? `image-set(url(${textureWebp}) type("image/webp"), url(${texturePng}) type("image/png"))`
      : null;
  return (
    <div
      className="bg-background flex min-h-full flex-col overflow-x-clip bg-cover bg-fixed"
      style={texture ? { backgroundImage: texture } : undefined}
    >
      <IconSprite />
      <SiteHeader
        user={
          user
            ? { displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role, unread }
            : null
        }
        whatsappUrl={socialLinks.find((s) => s.platform === "WHATSAPP")?.url ?? null}
      />
      <main id="main" className="page-container min-h-[85vh] flex-1">
        {children}
      </main>
      <SiteFooter
        socialLinks={socialLinks}
        partners={sponsors.map((s) => ({ id: s.id, name: s.name, logoUrl: s.logoUrl, url: s.url }))}
      />
      <PageViewBeacon />
    </div>
  );
}
