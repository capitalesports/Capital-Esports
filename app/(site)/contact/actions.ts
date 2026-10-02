"use server";

import { headers } from "next/headers";
import { runAction } from "@/server/action";
import { getCurrentUser } from "@/server/auth/session";
import { clientIp } from "@/server/http";
import { submitContactMessage } from "@/server/services/contact";

/** Public (no login needed); validated, honeypot-protected and rate-limited per IP. */
export async function submitContactAction(input: {
  name: string;
  contact: string;
  message: string;
  website?: string;
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    await submitContactMessage(input, clientIp(await headers()), user?.id ?? null);
  }, "Message sent. We usually reply within a day.");
}
