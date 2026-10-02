"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import {
  banUser,
  mergeUsers,
  resetGameProfile,
  setUserDateOfBirth,
  setUserRole,
  unbanUser,
} from "@/server/services/admin-users";

function refresh(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function banUserAction(input: { userId: string; reason: string; until?: string }) {
  return runAction(async () => {
    await banUser(await requireAdmin(), input);
    refresh(input.userId);
  }, "User banned");
}

export async function unbanUserAction(input: { userId: string }) {
  return runAction(async () => {
    await unbanUser(await requireAdmin(), input);
    refresh(input.userId);
  }, "User unbanned");
}

export async function resetGameProfileAction(input: { userId: string; game: string }) {
  return runAction(async () => {
    await resetGameProfile(await requireAdmin(), input);
    refresh(input.userId);
  }, "Game profile reset");
}

export async function setUserDateOfBirthAction(input: { userId: string; dateOfBirth: string }) {
  return runAction(async () => {
    await setUserDateOfBirth(await requireAdmin(), input);
    refresh(input.userId);
  }, "Date of birth updated");
}

export async function setUserRoleAction(input: { userId: string; role: string }) {
  return runAction(async () => {
    await setUserRole(await requireAdmin(), input);
    refresh(input.userId);
  }, "Role updated");
}

export async function mergeUsersAction(input: { primaryId: string; duplicateId: string }) {
  return runAction(async () => {
    const moved = await mergeUsers(await requireAdmin(), input);
    refresh(input.primaryId);
    refresh(input.duplicateId);
    return moved;
  }, "Accounts merged");
}
