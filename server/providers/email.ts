import "server-only";
import { stubsForbidden } from "@/server/env";
import { AppError } from "@/server/errors";
import { DS } from "@/lib/design-tokens";
import { SITE_NAME } from "@/lib/site";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email. Resend in production; a local stub (console + outbox) otherwise. */
export interface EmailSender {
  readonly kind: "resend" | "stub";
  send(message: EmailMessage): Promise<void>;
}

class ResendSender implements EmailSender {
  readonly kind = "resend" as const;
  constructor(private config: { apiKey: string; from: string }) {}

  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.config.from, ...message }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}

/** Emails the stub "sent" (tests read codes from here). Dev and test only. */
export const stubOutbox: EmailMessage[] = [];

class StubSender implements EmailSender {
  readonly kind = "stub" as const;
  async send(message: EmailMessage) {
    stubOutbox.push(message);
    if (stubOutbox.length > 100) stubOutbox.shift();
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email] to ${message.to}: ${message.subject}\n${message.text}`);
    }
  }
}

export function emailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

export function getEmailSender(): EmailSender {
  const config = emailConfig();
  if (config) return new ResendSender(config);
  if (stubsForbidden()) throw new AppError("UNAVAILABLE", "Email is not configured.");
  return new StubSender();
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Plain, dark-agnostic email body: a heading, a paragraph and an optional button link. */
export function renderEmail(opts: {
  title: string;
  body: string;
  link?: { url: string; label: string };
}): {
  text: string;
  html: string;
} {
  const text = [
    opts.title,
    "",
    opts.body,
    ...(opts.link ? ["", `${opts.link.label}: ${opts.link.url}`] : []),
  ].join("\n");
  const button = opts.link
    ? `<p><a href="${escapeHtml(opts.link.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${DS.gold};color:${DS.background};text-decoration:none;font-weight:600">${escapeHtml(opts.link.label)}</a></p>`
    : "";
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;max-width:520px"><h2 style="margin:0 0 12px">${escapeHtml(opts.title)}</h2><p>${escapeHtml(opts.body)}</p>${button}<p style="opacity:0.6;font-size:12px">You get this email because it is verified on your ${escapeHtml(SITE_NAME)} account. Turn email notifications off on your profile.</p></div>`;
  return { text, html };
}
