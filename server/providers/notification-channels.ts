import "server-only";
import { isProductionDeployment } from "@/server/env";
import type { NotificationMessage } from "@/lib/notifications";

/**
 * Out-of-app delivery (WhatsApp / SMS). Only a console implementation exists today; a provider
 * (e.g. MSG91, Gupshup, WhatsApp Cloud API) can be added here without touching call sites.
 */
export interface NotificationChannel {
  readonly name: string;
  send(to: { userId: string; phone: string }, message: NotificationMessage): Promise<void>;
}

class ConsoleChannel implements NotificationChannel {
  readonly name = "console";
  async send(to: { userId: string; phone: string }, message: NotificationMessage) {
    if (!isProductionDeployment() && process.env.NODE_ENV !== "test") {
      console.info(`[reminder] to ${to.userId}: ${message.title} — ${message.body}`);
    }
  }
}

export function getReminderChannels(): NotificationChannel[] {
  return [new ConsoleChannel()];
}

export interface WebPushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushSender {
  readonly kind: "vapid" | "stub";
  send(
    sub: { endpoint: string; p256dh: string; auth: string },
    payload: WebPushPayload,
  ): Promise<"sent" | "gone" | "failed">;
}

class VapidPushSender implements PushSender {
  readonly kind = "vapid" as const;
  constructor(private keys: { publicKey: string; privateKey: string; subject: string }) {}

  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: WebPushPayload) {
    const webpush = (await import("web-push")).default;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        {
          TTL: 3600,
          vapidDetails: {
            subject: this.keys.subject,
            publicKey: this.keys.publicKey,
            privateKey: this.keys.privateKey,
          },
        },
      );
      return "sent" as const;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? ("gone" as const) : ("failed" as const);
    }
  }
}

class StubPushSender implements PushSender {
  readonly kind = "stub" as const;
  async send() {
    return "sent" as const;
  }
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function getPushSender(): PushSender {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey)
    return new VapidPushSender({
      publicKey,
      privateKey,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    });
  return new StubPushSender();
}
