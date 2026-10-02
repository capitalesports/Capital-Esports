"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/guards";
import {
  changePhone,
  saveGameProfile,
  updateAvatar,
  updateProfile,
} from "@/server/services/profile";
import { AppError } from "@/server/errors";
import {
  confirmEmailVerification,
  removeEmail,
  requestEmailVerification,
  setEmailOptIn,
} from "@/server/services/email";
import {
  cancelAccountDeletionRequest,
  requestAccountDeletion,
} from "@/server/services/account-deletion";
import { savePayoutMethod } from "@/server/services/payouts";

export async function updateProfileAction(input: { displayName: string; dateOfBirth: string }) {
  return runAction(async () => {
    const actor = await requireUser();
    await updateProfile(actor, input);
    revalidatePath("/", "layout");
  }, "Profile saved");
}

export async function uploadAvatarAction(form: FormData) {
  return runAction(async () => {
    const actor = await requireUser();
    const file = form.get("avatar");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose an image to upload.");
    const url = await updateAvatar(actor, new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/profile");
    return url;
  }, "Avatar updated");
}

export async function saveGameProfileAction(input: {
  game: string;
  gameId: string;
  ign?: string;
  region?: string;
}) {
  return runAction(async () => {
    const actor = await requireUser();
    await saveGameProfile(actor, input);
    revalidatePath("/profile");
  }, "Game ID saved");
}

export async function requestAccountDeletionAction(input: { reason?: string }) {
  return runAction(async () => {
    await requestAccountDeletion(await requireUser(), input);
    revalidatePath("/profile");
  }, "Deletion request sent. An admin will review it.");
}

export async function cancelAccountDeletionRequestAction() {
  return runAction(async () => {
    await cancelAccountDeletionRequest(await requireUser());
    revalidatePath("/profile");
  }, "Deletion request cancelled");
}

export async function changePhoneAction(input: { idToken: string }) {
  return runAction(async () => {
    const { phone } = await changePhone(await requireUser(), input);
    revalidatePath("/profile");
    return phone;
  }, "Phone number updated");
}

export async function requestEmailVerificationAction(input: { email: string }) {
  return runAction(async () => {
    const { email } = await requestEmailVerification(await requireUser(), input);
    return email;
  }, "Code sent. Check your inbox.");
}

export async function confirmEmailVerificationAction(input: { code: string }) {
  return runAction(async () => {
    const { email } = await confirmEmailVerification(await requireUser(), input);
    revalidatePath("/profile");
    return email;
  }, "Email verified");
}

export async function removeEmailAction() {
  return runAction(async () => {
    await removeEmail(await requireUser());
    revalidatePath("/profile");
  }, "Email removed");
}

export async function setEmailOptInAction(input: { optIn: boolean }) {
  return runAction(
    async () => {
      await setEmailOptIn(await requireUser(), input);
      revalidatePath("/profile");
    },
    input.optIn ? "Email notifications on" : "Email notifications off",
  );
}

export async function savePayoutMethodAction(input: Record<string, string>) {
  return runAction(async () => {
    await savePayoutMethod(await requireUser(), input);
    revalidatePath("/profile");
  }, "Payout method saved");
}
