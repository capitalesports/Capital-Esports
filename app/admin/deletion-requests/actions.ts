"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAdmin } from "@/server/auth/guards";
import { approveDeletionRequest, rejectDeletionRequest } from "@/server/services/account-deletion";

function refresh() {
  revalidatePath("/admin/deletion-requests");
  revalidatePath("/admin");
  revalidatePath("/admin/users");
}

export async function approveDeletionRequestAction(input: { requestId: string; note?: string }) {
  return runAction(async () => {
    await approveDeletionRequest(await requireAdmin(), input);
    refresh();
  }, "Account deleted");
}

export async function rejectDeletionRequestAction(input: { requestId: string; note?: string }) {
  return runAction(async () => {
    await rejectDeletionRequest(await requireAdmin(), input);
    refresh();
  }, "Request declined; the player was notified");
}
