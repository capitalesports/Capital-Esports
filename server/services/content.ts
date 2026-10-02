import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  carouselItemSchema,
  contentSchema,
  HOME_SETTING_KEYS,
  homeSettingsFromRows,
  homeSettingsSchema,
  socialLinksSchema,
  sponsorSchema,
  type ContentKey,
  type HomeSettings,
} from "@/lib/content";
import { assertAdmin, type Actor } from "@/lib/roles";
import { SOCIAL_PLATFORMS, type SocialLink } from "@/lib/site";

// ---------- public reads ----------

export async function getContent(key: ContentKey): Promise<string> {
  const row = await db.siteContent.findUnique({ where: { key } });
  return row?.body ?? "";
}

export async function getSocialLinks(): Promise<SocialLink[]> {
  const rows = await db.socialLink.findMany();
  const byPlatform = new Map(rows.map((r) => [r.platform, r.url]));
  return SOCIAL_PLATFORMS.map((platform) => ({ platform, url: byPlatform.get(platform) ?? null }));
}

/** Home page settings (stats text, live-stats toggle, trailer link, hero taglines), with defaults. */
export async function getHomeSettings(): Promise<HomeSettings> {
  const rows = await db.siteContent.findMany({
    where: { key: { in: Object.values(HOME_SETTING_KEYS) } },
  });
  return homeSettingsFromRows(rows);
}

export function getActiveSponsors() {
  return db.sponsor.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

// ---------- admin mutations ----------

export async function saveContent(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { key, body } = parseInput(contentSchema, input);
  await db.$transaction(async (tx) => {
    const before = await tx.siteContent.findUnique({ where: { key } });
    await tx.siteContent.upsert({
      where: { key },
      create: { key, body, updatedById: me.id },
      update: { body, updatedById: me.id },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "content.save",
      entityType: "SiteContent",
      entityId: key,
      before: before ? { length: before.body.length } : null,
      after: { length: body.length },
    });
  });
}

export async function saveSocialLinks(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const links = parseInput(socialLinksSchema, input);
  await db.$transaction(async (tx) => {
    const before = await tx.socialLink.findMany();
    for (const platform of SOCIAL_PLATFORMS) {
      const url = links[platform];
      if (url)
        await tx.socialLink.upsert({
          where: { platform },
          create: { platform, url },
          update: { url },
        });
      else await tx.socialLink.deleteMany({ where: { platform } });
    }
    await writeAudit(tx, {
      actorId: me.id,
      action: "content.socialLinks",
      entityType: "SocialLink",
      entityId: "all",
      before,
      after: links,
    });
  });
}

export async function saveHomeSettings(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const v = parseInput(homeSettingsSchema, input);
  const values: Record<keyof typeof HOME_SETTING_KEYS, string> = {
    statPlayers: v.statPlayers,
    statTournaments: v.statTournaments,
    statPrize: v.statPrize,
    liveStats: v.liveStats ? "true" : "false",
    trailerUrl: v.trailerUrl ?? "",
    taglineFreeFire: v.taglineFreeFire,
    taglineBgmi: v.taglineBgmi,
    taglineValorant: v.taglineValorant,
  };
  await db.$transaction(async (tx) => {
    const before = homeSettingsFromRows(
      await tx.siteContent.findMany({ where: { key: { in: Object.values(HOME_SETTING_KEYS) } } }),
    );
    for (const [field, key] of Object.entries(HOME_SETTING_KEYS) as [
      keyof typeof HOME_SETTING_KEYS,
      string,
    ][]) {
      const body = values[field];
      await tx.siteContent.upsert({
        where: { key },
        create: { key, body, updatedById: me.id },
        update: { body, updatedById: me.id },
      });
    }
    await writeAudit(tx, {
      actorId: me.id,
      action: "content.homeSettings",
      entityType: "SiteContent",
      entityId: "home",
      before,
      after: v,
    });
  });
}

export async function saveSponsor(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { id, ...data } = parseInput(sponsorSchema, input);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.sponsor.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Sponsor not found.");
    const saved = id
      ? await tx.sponsor.update({ where: { id }, data })
      : await tx.sponsor.create({ data });
    await writeAudit(tx, {
      actorId: me.id,
      action: id ? "sponsor.update" : "sponsor.create",
      entityType: "Sponsor",
      entityId: saved.id,
      before,
      after: saved,
    });
    return saved;
  });
}

export async function deleteSponsor(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { id } = parseInput(z.object({ id: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const before = await tx.sponsor.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Sponsor not found.");
    await tx.sponsor.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "sponsor.delete",
      entityType: "Sponsor",
      entityId: id,
      before,
    });
  });
}

export async function saveCarouselItem(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { id, ...data } = parseInput(carouselItemSchema, input);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.carouselItem.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Carousel item not found.");
    const saved = id
      ? await tx.carouselItem.update({ where: { id }, data })
      : await tx.carouselItem.create({ data });
    await writeAudit(tx, {
      actorId: me.id,
      action: id ? "carousel.update" : "carousel.create",
      entityType: "CarouselItem",
      entityId: saved.id,
      before,
      after: saved,
    });
    return saved;
  });
}

export async function deleteCarouselItem(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { id } = parseInput(z.object({ id: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const before = await tx.carouselItem.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Carousel item not found.");
    await tx.carouselItem.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: me.id,
      action: "carousel.delete",
      entityType: "CarouselItem",
      entityId: id,
      before,
    });
  });
}
