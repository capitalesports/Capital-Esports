"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import {
  deleteCarouselItem,
  deleteSponsor,
  saveCarouselItem,
  saveContent,
  saveHomeSettings,
  saveSocialLinks,
  saveSponsor,
} from "@/server/services/content";
import { markContactHandled } from "@/server/services/contact";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveContentAction(input: { key: string; body: string }) {
  return runAction(async () => {
    await saveContent(await requireAdmin(), input);
    refresh();
  }, "Content saved");
}

export async function saveHomeSettingsAction(input: {
  statPlayers: string;
  statTournaments: string;
  statPrize: string;
  liveStats: boolean;
  trailerUrl: string;
  taglineFreeFire: string;
  taglineBgmi: string;
  taglineValorant: string;
}) {
  return runAction(async () => {
    await saveHomeSettings(await requireAdmin(), input);
    refresh();
  }, "Home page saved");
}

export async function saveSocialLinksAction(input: Record<string, string>) {
  return runAction(async () => {
    await saveSocialLinks(await requireAdmin(), input);
    refresh();
  }, "Social links saved");
}

export async function saveSponsorAction(input: {
  id?: string;
  name: string;
  logoUrl: string;
  url?: string;
  order: number;
  active: boolean;
}) {
  return runAction(async () => {
    await saveSponsor(await requireAdmin(), input);
    refresh();
  }, "Sponsor saved");
}

export async function deleteSponsorAction(input: { id: string }) {
  return runAction(async () => {
    await deleteSponsor(await requireAdmin(), input);
    refresh();
  }, "Sponsor deleted");
}

export async function saveCarouselItemAction(input: {
  id?: string;
  game?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  linkUrl?: string;
  order: number;
  active: boolean;
}) {
  return runAction(async () => {
    await saveCarouselItem(await requireAdmin(), input);
    refresh();
  }, "Carousel item saved");
}

export async function deleteCarouselItemAction(input: { id: string }) {
  return runAction(async () => {
    await deleteCarouselItem(await requireAdmin(), input);
    refresh();
  }, "Carousel item deleted");
}

export async function markContactHandledAction(input: { id: string }) {
  return runAction(async () => {
    await markContactHandled(await requireAdmin(), input);
    revalidatePath("/admin/content");
  }, "Marked as handled");
}
