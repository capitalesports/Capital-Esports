"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/guards";
import {
  createTeam,
  findTeamByCode,
  inviteToTeam,
  joinTeamByCode,
  leaveTeam,
  removeTeamMember,
  respondToTeamInvite,
  transferCaptaincy,
} from "@/server/services/teams";

function refresh() {
  revalidatePath("/teams");
  revalidatePath("/dashboard");
}

export async function createTeamAction(input: { game: string; name: string }) {
  return runAction(async () => {
    await createTeam(await requireUser(), input);
    refresh();
  }, "Team created");
}

export async function findTeamByCodeAction(input: { code: string }) {
  return runAction(async () => findTeamByCode(await requireUser(), input));
}

export async function joinTeamByCodeAction(input: { code: string }) {
  return runAction(async () => {
    const r = await joinTeamByCode(await requireUser(), input);
    refresh();
    return r;
  }, "You joined the team");
}

export async function inviteToTeamAction(input: { teamId: string; gameId: string }) {
  return runAction(async () => {
    await inviteToTeam(await requireUser(), input);
    refresh();
  }, "Invite sent");
}

export async function respondToTeamInviteAction(input: { teamId: string; accept: boolean }) {
  return runAction(
    async () => {
      await respondToTeamInvite(await requireUser(), input);
      refresh();
    },
    input.accept ? "You joined the team" : "Invite declined",
  );
}

export async function leaveTeamAction(input: { teamId: string }) {
  return runAction(async () => {
    await leaveTeam(await requireUser(), input);
    refresh();
  }, "You left the team");
}

export async function removeTeamMemberAction(input: { teamId: string; userId: string }) {
  return runAction(async () => {
    await removeTeamMember(await requireUser(), input);
    refresh();
  }, "Player removed");
}

export async function transferCaptaincyAction(input: { teamId: string; userId: string }) {
  return runAction(async () => {
    await transferCaptaincy(await requireUser(), input);
    refresh();
  }, "Captaincy transferred");
}
