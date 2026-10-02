"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin, requireModerator } from "@/server/auth/guards";
import {
  bulkCloneMatch,
  cancelMatch,
  cloneMatch,
  createMatch,
  deleteMatch,
  setRoomCredentials,
  transitionMatchStatus,
  updateMatch,
} from "@/server/services/matches";
import {
  adminPromoteRegistration,
  adminRemoveRegistration,
} from "@/server/services/admin-registrations";
import type { MatchFormInput } from "@/lib/match-schema";

function refresh(matchId?: string) {
  revalidatePath("/admin/matches");
  if (matchId) revalidatePath(`/admin/matches/${matchId}`);
  revalidatePath("/scrims");
}

export async function createMatchAction(input: MatchFormInput) {
  return runAction(async () => {
    const actor = await requireModerator();
    const match = await createMatch(actor, input);
    refresh();
    return match.id;
  }, "Match created");
}

export async function updateMatchAction(matchId: string, input: MatchFormInput) {
  return runAction(async () => {
    const actor = await requireModerator();
    await updateMatch(actor, matchId, input);
    refresh(matchId);
    return matchId;
  }, "Match updated");
}

export async function cloneMatchAction(input: { matchId: string; startsAt: string }) {
  return runAction(async () => {
    const actor = await requireModerator();
    const clone = await cloneMatch(actor, input);
    refresh(input.matchId);
    return clone.id;
  }, "Match cloned");
}

export async function bulkCloneMatchAction(input: { matchId: string; days: number }) {
  return runAction(async () => {
    const actor = await requireModerator();
    const clones = await bulkCloneMatch(actor, input);
    refresh(input.matchId);
    return clones.length;
  }, `Cloned for the next ${input.days} day(s)`);
}

export async function transitionMatchAction(input: { matchId: string; to: string }) {
  return runAction(async () => {
    const actor = await requireModerator();
    await transitionMatchStatus(actor, input);
    refresh(input.matchId);
  }, "Status updated");
}

export async function setRoomCredentialsAction(input: {
  matchId: string;
  roomId: string;
  /** Not sent for Valorant (a single room code). */
  roomPassword?: string;
}) {
  return runAction(async () => {
    const actor = await requireModerator();
    await setRoomCredentials(actor, input);
    refresh(input.matchId);
  }, "Room credentials saved");
}

export async function cancelMatchAction(input: { matchId: string; reason: string }) {
  return runAction(async () => {
    const actor = await requireModerator();
    const result = await cancelMatch(actor, input);
    refresh(input.matchId);
    return result;
  }, "Match cancelled");
}

export async function deleteMatchAction(input: { matchId: string }) {
  return runAction(async () => {
    const actor = await requireAdmin();
    await deleteMatch(actor, input);
    refresh(input.matchId);
    revalidatePath("/admin/results");
  }, "Match deleted");
}

export async function removeRegistrationAction(input: {
  matchId: string;
  registrationId: string;
  reason: string;
}) {
  return runAction(async () => {
    const actor = await requireModerator();
    const result = await adminRemoveRegistration(actor, input);
    refresh(input.matchId);
    return result;
  }, "Entry removed");
}

export async function promoteRegistrationAction(input: {
  matchId: string;
  registrationId: string;
}) {
  return runAction(async () => {
    const actor = await requireModerator();
    const status = await adminPromoteRegistration(actor, input);
    refresh(input.matchId);
    return status;
  }, "Entry promoted");
}
