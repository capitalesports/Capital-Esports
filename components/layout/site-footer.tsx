/* eslint-disable @next/next/no-img-element -- partner logos are admin-supplied URLs */
import { BrandIcon } from "@/components/common/brand-icon";
import { IntentLink as Link } from "@/components/common/intent-link";
import { BrandWordmark } from "@/components/layout/brand-logo";
import { FOOTER_LINKS, LEGAL_NAV } from "@/lib/nav";
import { SITE_NAME, SOCIAL_LABELS, type SocialLink } from "@/lib/site";

export interface Partner {
  id: string;
  name: string;
  logoUrl: string;
  url: string | null;
}

/** home-desktop.png's "Our Partners" row; only rendered once admins have added real sponsor logos. */
function PartnersRow({ partners }: { partners: Partner[] }) {
  return (
    <section aria-labelledby="partners-h" className="border-border border-b">
      <div className="page-container flex flex-col gap-4 py-6 lg:flex-row lg:items-center">
        <div className="lg:border-border shrink-0 lg:w-64 lg:border-r lg:pr-6">
          <h2 id="partners-h" className="text-base font-bold">
            Our Partners
          </h2>
          <p className="text-muted-foreground text-xs">Supporting the esports community in India</p>
        </div>
        <ul className="flex flex-1 flex-wrap items-center gap-x-10 gap-y-4">
          {partners.map((p) => {
            const logo = (
              <img
                src={p.logoUrl}
                alt={p.name}
                loading="lazy"
                className="h-8 w-auto max-w-32 object-contain opacity-90 hover:opacity-100"
              />
            );
            return (
              <li key={p.id}>
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="min-h-tap inline-flex items-center"
                  >
                    {logo}
                  </a>
                ) : (
                  logo
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Brand() {
  return (
    <div className="shrink-0">
      <BrandWordmark />
      <p className="text-muted-foreground text-xs">India&apos;s Biggest Esports Platform</p>
    </div>
  );
}

function SocialIcons({ socialLinks }: { socialLinks: SocialLink[] }) {
  return (
    <section aria-label="Follow us">
      <ul className="flex items-center gap-1">
        {socialLinks.map((s) => {
          const icon = <BrandIcon platform={s.platform} />;
          return (
            <li key={s.platform}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={SOCIAL_LABELS[s.platform]}
                  title={SOCIAL_LABELS[s.platform]}
                  className="text-foreground hover:text-gold flex size-11 items-center justify-center rounded-md"
                >
                  {icon}
                </a>
              ) : (
                <span
                  role="img"
                  aria-label={`${SOCIAL_LABELS[s.platform]} (coming soon)`}
                  title={`${SOCIAL_LABELS[s.platform]} — coming soon`}
                  className="text-muted-foreground flex size-11 items-center justify-center"
                >
                  {icon}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Footer: the partners row from home-desktop.png (when sponsors exist), then scrims-desktop.png's bar
 * (brand + tagline · links · social icons · copyright), then a small legal row.
 */
export function SiteFooter({
  socialLinks,
  partners,
}: {
  socialLinks: SocialLink[];
  partners: Partner[];
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-border bg-background/60 mt-16 border-t">
      {partners.length ? <PartnersRow partners={partners} /> : null}
      <div className="page-container flex flex-col gap-5 py-6 lg:flex-row lg:items-center lg:gap-6 xl:gap-10">
        <Brand />
        <nav aria-label="Footer" className="lg:flex-1">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 xl:flex-nowrap">
            {FOOTER_LINKS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="min-h-tap text-foreground hover:text-gold inline-flex items-center text-sm whitespace-nowrap"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SocialIcons socialLinks={socialLinks} />
        <p className="text-muted-foreground text-xs lg:max-w-44 xl:max-w-none">
          © {year} {SITE_NAME}. All rights reserved.
        </p>
      </div>
      <div className="border-border border-t">
        <div className="page-container flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-4">
              {LEGAL_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="min-h-tap text-muted-foreground hover:text-gold inline-flex items-center text-xs"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-muted-foreground text-xs">
            Not affiliated with Garena, Krafton or Riot Games. Times shown in IST.
          </p>
        </div>
      </div>
    </footer>
  );
}
