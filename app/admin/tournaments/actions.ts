"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import {
  addLobbyMatches,
  cancelTournament,
  createTournament,
  generateBracket,
  lockEntries,
  publishWinners,
  updateTournament,
} from "@/server/services/tournaments";

function refresh(id?: string) {
  revalidatePath("/admin/tournaments");
  if (id) revalidatePath(`/admin/tournaments/${id}`);
  revalidatePath("/tournament", "layout");
  revalidatePath("/");
}

export async function createTournamentAction(input: Record<string, string>) {
  return runAction(async () => {
    const t = await createTournament(await requireAdmin(), input);
    refresh();
    return t.id;
  }, "Tournament created; sign-ups are open");
}

export async function updateTournamentAction(input: {
  tournamentId: string;
  title: string;
  prizePool: string;
  rulesMarkdown: string;
  streamUrl?: string;
  startsAt?: string;
  mode?: string;
  entryFee?: string;
}) {
  return runAction(async () => {
    await updateTournament(await requireAdmin(), input);
    refresh(input.tournamentId);
  }, "Tournament saved");
}

export async function cancelTournamentAction(input: { tournamentId: string; reason: string }) {
  return runAction(async () => {
    const r = await cancelTournament(await requireAdmin(), input);
    refresh(input.tournamentId);
    revalidatePath("/scrims");
    return r;
  }, "Tournament cancelled; entries are being refunded");
}

export async function addLobbyMatchesAction(input: {
  tournamentId: string;
  count: string;
  firstStartsAt: string;
  gapMinutes: string;
}) {
  return runAction(async () => {
    await addLobbyMatches(await requireAdmin(), input);
    refresh(input.tournamentId);
  }, "Lobby matches added");
}

export async function lockEntriesAction(input: { tournamentId: string }) {
  return runAction(async () => {
    const r = await lockEntries(await requireAdmin(), input);
    refresh(input.tournamentId);
    return r;
  }, "Registration closed; entries split into lobbies");
}

export async function generateBracketAction(input: {
  tournamentId: string;
  firstRoundStartsAt: string;
}) {
  return runAction(async () => {
    await generateBracket(await requireAdmin(), input);
    refresh(input.tournamentId);
  }, "Bracket drawn");
}

export async function publishWinnersAction(input: { tournamentId: string; prizes: string[] }) {
  return runAction(async () => {
    await publishWinners(await requireAdmin(), input);
    refresh(input.tournamentId);
  }, "Winners published to the home carousel");
}
