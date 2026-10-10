import { getSocialLinks } from "@/server/services/content";
import { SITE_NAME, SUPPORT_EMAIL, siteUrl } from "@/lib/site";

/**
 * Home page structured data (DECISIONS M63): tells search engines this site is the Indian esports
 * platform "Capital Esports" (other teams share the name), with its logo and social profiles.
 */
export async function SiteJsonLd() {
  const url = siteUrl();
  const sameAs = (await getSocialLinks()).flatMap((l) => (l.url ? [l.url] : []));
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${url}/#organization`,
      name: SITE_NAME,
      alternateName: ["Capital Esports India", "capitalesports.in"],
      url,
      logo: `${url}/icons/512`,
      email: SUPPORT_EMAIL,
      address: { "@type": "PostalAddress", addressLocality: "New Delhi", addressCountry: "IN" },
      description:
        "Indian esports platform for Free Fire, BGMI and Valorant: daily scrims, weekly tournaments and leaderboards.",
      ...(sameAs.length ? { sameAs } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${url}/#website`,
      name: SITE_NAME,
      url,
      inLanguage: "en-IN",
      publisher: { "@id": `${url}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: `${url}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
  return (
    <script
      type="application/ld+json"
      // JSON only; "<" is escaped so nothing in it can close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
