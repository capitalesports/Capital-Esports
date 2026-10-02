import { beforeEach, describe, expect, it } from "vitest";
import { CONTACT_LIMIT, listContactMessages, markContactHandled, submitContactMessage } from "@/server/services/contact";
import type { Actor } from "@/lib/roles";
import { createUser, resetDb, testDb } from "../helpers/db";

let admin: Actor;
const valid = { name: "Ravi", contact: "ravi@example.com", message: "My room ID never showed up." };

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

describe("contact form", () => {
  it("validates input and rejects bots filling the honeypot", async () => {
    await expect(submitContactMessage({ ...valid, message: "short" }, "1.1.1.1", null)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitContactMessage({ ...valid, name: "" }, "1.1.1.1", null)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitContactMessage({ ...valid, website: "http://spam" }, "1.1.1.1", null)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await testDb().contactMessage.count()).toBe(0);
  });

  it("stores messages and rate-limits per IP", async () => {
    for (let i = 0; i < CONTACT_LIMIT.limit; i++) await submitContactMessage(valid, "2.2.2.2", null);
    await expect(submitContactMessage(valid, "2.2.2.2", null)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await submitContactMessage(valid, "3.3.3.3", null);
    expect(await testDb().contactMessage.count()).toBe(CONTACT_LIMIT.limit + 1);
  });

  it("only admins read and close messages", async () => {
    const msg = await submitContactMessage(valid, "4.4.4.4", null);
    await expect(listContactMessages({ id: "m", role: "MODERATOR" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(markContactHandled({ id: "m", role: "MODERATOR" }, { id: msg.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listContactMessages(admin)).map((m) => m.id)).toEqual([msg.id]);
    await markContactHandled(admin, { id: msg.id });
    expect(await listContactMessages(admin)).toEqual([]);
    await expect(markContactHandled(admin, { id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
