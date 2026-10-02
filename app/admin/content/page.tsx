import type { Metadata } from "next";
import {
  CarouselItemEditor,
  HomeSettingsEditor,
  MarkdownContentEditor,
  SocialLinksEditor,
  SponsorEditor,
} from "@/components/admin/content-editors";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { db } from "@/server/db";
import { getHomeSettings, getSocialLinks } from "@/server/services/content";
import { listContactMessages } from "@/server/services/contact";
import { toActor } from "@/server/auth/session";
import { ContactMessageRow } from "@/components/admin/contact-message-row";
import { CONTENT_KEYS, type ContentKey } from "@/lib/content";

export const metadata: Metadata = { title: "Content" };

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="space-y-3">
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function AdminContentPage() {
  const user = await requireStaffPage("/admin/content");
  const [contentRows, socialLinks, sponsors, carousel, messages, home] = await Promise.all([
    db.siteContent.findMany(),
    getSocialLinks(),
    db.sponsor.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    db.carouselItem.findMany({ orderBy: [{ order: "asc" }, { createdAt: "desc" }] }),
    listContactMessages(toActor(user)),
    getHomeSettings(),
  ]);
  const bodies = Object.fromEntries(
    CONTENT_KEYS.map((k) => [k, contentRows.find((r) => r.key === k)?.body ?? ""]),
  ) as Record<ContentKey, string>;

  return (
    <>
      <PageHeader
        title="Content"
        description="Rules, FAQ, legal pages, sponsors, social links and the home carousel."
      />
      <nav aria-label="Content sections" className="mb-6 flex flex-wrap gap-3 text-sm">
        {[
          ["home", "Home page"],
          ["pages", "Pages"],
          ["social", "Social links"],
          ["sponsors", "Sponsors"],
          ["carousel", "Carousel"],
          ["messages", `Messages (${messages.length})`],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="min-h-tap inline-flex items-center underline-offset-4 hover:underline"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="max-w-3xl space-y-10">
        <Section id="home" title="Home page">
          <HomeSettingsEditor settings={home} />
        </Section>
        <Section id="pages" title="Pages (markdown)">
          <MarkdownContentEditor initial={bodies} />
        </Section>
        <Section id="social" title="Social links">
          <SocialLinksEditor links={socialLinks} />
        </Section>
        <Section id="sponsors" title="Sponsors">
          {sponsors.map((s) => (
            <SponsorEditor
              key={s.id}
              sponsor={{
                id: s.id,
                name: s.name,
                logoUrl: s.logoUrl,
                url: s.url ?? "",
                order: s.order,
                active: s.active,
              }}
            />
          ))}
          <SponsorEditor />
        </Section>
        <Section id="carousel" title="Home carousel">
          <p className="text-muted-foreground text-sm">
            Not shown on the home page any more: its &quot;Last Week&apos;s Winners&quot; section
            reads published tournament winners directly. Kept for reference and a later cleanup.
          </p>
          {carousel.map((c) => (
            <CarouselItemEditor
              key={c.id}
              item={{
                id: c.id,
                game: c.game ?? "",
                title: c.title,
                subtitle: c.subtitle ?? "",
                imageUrl: c.imageUrl ?? "",
                linkUrl: c.linkUrl ?? "",
                order: c.order,
                active: c.active,
              }}
            />
          ))}
          <CarouselItemEditor />
        </Section>
        <Section id="messages" title="Contact messages">
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">No open messages.</p>
          ) : null}
          <ul className="space-y-3">
            {messages.map((m) => (
              <ContactMessageRow
                key={m.id}
                message={{
                  id: m.id,
                  name: m.name,
                  contact: m.contact,
                  message: m.message,
                  createdAt: m.createdAt.toISOString(),
                }}
              />
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
