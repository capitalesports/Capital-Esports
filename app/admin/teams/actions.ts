"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireModerator } from "@/server/auth/guards";
import { adminRemoveTeamMember, adminTransferCaptain } from "@/server/services/admin-teams";

export async function adminRemoveTeamMemberAction(input: { teamId: string; userId: string }) {
  return runAction(async () => {
    await adminRemoveTeamMember(await requireModerator(), input);
    revalidatePath(`/admin/teams/${input.teamId}`);
  }, "Member removed");
}

export async function adminTransferCaptainAction(input: { teamId: string; userId: string }) {
  return runAction(async () => {
    await adminTransferCaptain(await requireModerator(), input);
    revalidatePath(`/admin/teams/${input.teamId}`);
  }, "Captain transferred");
}
