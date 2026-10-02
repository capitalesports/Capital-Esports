import type { Metadata } from "next";
import { MailIcon, MapPinIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ContactForm } from "@/components/content/contact-form";
import { Button } from "@/components/ui/button";
import { getSocialLinks } from "@/server/services/content";
import { SOCIAL_LABELS, SUPPORT_EMAIL, SUPPORT_LOCATION } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact & support",
  description: "Reach the team by email, the contact form, WhatsApp or Discord.",
};

export default async function ContactPage() {
  const socials = (await getSocialLinks()).filter(
    (s) => (s.platform === "WHATSAPP" || s.platform === "DISCORD") && s.url,
  );
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Contact & support"
        description="Questions about a match, a payment or your account? Send us a message."
      />
      <section aria-label="Support details" className="card-ds mb-6 space-y-3 p-4 text-sm">
        <p className="flex items-center gap-2">
          <MailIcon aria-hidden className="text-gold size-4 shrink-0" />
          <span>
            Email:{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </span>
        </p>
        <p className="flex items-center gap-2">
          <MapPinIcon aria-hidden className="text-gold size-4 shrink-0" />
          <span>Capital Esports, {SUPPORT_LOCATION}</span>
        </p>
        <p className="text-muted-foreground">We reply within 1–2 working days.</p>
      </section>
      {socials.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {socials.map((s) => (
            <Button key={s.platform} asChild variant="outline">
              <a href={s.url!} target="_blank" rel="noopener noreferrer">
                {SOCIAL_LABELS[s.platform]}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
      <ContactForm />
      <p className="text-muted-foreground mt-6 text-sm">
        Reporting a cheater or a wrong result? Use the Report button on the player&apos;s profile or
        the match page so a moderator sees it with the evidence.
      </p>
    </div>
  );
}
