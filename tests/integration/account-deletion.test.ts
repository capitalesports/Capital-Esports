import { beforeEach, describe, expect, it } from "vitest";
import {
  approveDeletionRequest,
  cancelAccountDeletionRequest,
  getMyPendingDeletionRequest,
  listDeletionRequests,
  rejectDeletionRequest,
  requestAccountDeletion,
} from "@/server/services/account-deletion";
import { loginWithGoogle } from "@/server/services/google-auth";
import type { Actor } from "@/lib/roles";
import { createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const player = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
let admin: Actor;
let moderator: Actor;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  moderator = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});

describe("account deletion requests (DECISIONS M39)", () => {
  it("a player requests deletion; asking again returns the same pending request", async () => {
    const u = await createPlayer();
    const first = await requestAccountDeletion(player(u), { reason: "  Not playing any more " });
    const again = await requestAccountDeletion(player(u), {});
    expect(again.id).toBe(first.id);
    const pending = await getMyPendingDeletionRequest(u.id);
    expect(pending).toMatchObject({ id: first.id, reason: "Not playing any more" });
    // The account itself is untouched until an admin approves.
    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toBeNull();
    expect(
      await testDb().auditLog.count({
        where: { action: "user.deletionRequest.create", actorId: u.id },
      }),
    ).toBe(1);
  });

  it("validates input and requires login", async () => {
    await expect(requestAccountDeletion(null, {})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const u = await createPlayer();
    await expect(
      requestAccountDeletion(player(u), { reason: "x".repeat(501) }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(requestAccountDeletion(player(u), { reason: 5 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(approveDeletionRequest(admin, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      rejectDeletionRequest(admin, { requestId: "r", note: "x".repeat(301) }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("the player can withdraw a pending request", async () => {
    const u = await createPlayer();
    await requestAccountDeletion(player(u), {});
    await cancelAccountDeletionRequest(player(u));
    expect(await getMyPendingDeletionRequest(u.id)).toBeNull();
    await expect(cancelAccountDeletionRequest(player(u))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("only admins can list, approve or decline", async () => {
    const u = await createPlayer();
    const req = await requestAccountDeletion(player(u), {});
    for (const actor of [player(u), moderator, null]) {
      await expect(listDeletionRequests(actor)).rejects.toMatchObject({
        code: actor ? "FORBIDDEN" : "UNAUTHENTICATED",
      });
      await expect(approveDeletionRequest(actor, { requestId: req.id })).rejects.toMatchObject({
        code: actor ? "FORBIDDEN" : "UNAUTHENTICATED",
      });
      await expect(rejectDeletionRequest(actor, { requestId: req.id })).rejects.toMatchObject({
        code: actor ? "FORBIDDEN" : "UNAUTHENTICATED",
      });
    }
    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toBeNull();
  });

  it("approving erases the account; the same Google account can then sign up again", async () => {
    const u = await createPlayer();
    await testDb().user.update({ where: { id: u.id }, data: { googleId: "g-123" } });
    const req = await requestAccountDeletion(player(u), { reason: "bye" });
    await approveDeletionRequest(admin, { requestId: req.id });

    const after = await testDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.deletedAt).not.toBeNull();
    expect(after).toMatchObject({ googleId: null, email: null, displayName: null });
    const closed = await testDb().accountDeletionRequest.findUniqueOrThrow({
      where: { id: req.id },
    });
    expect(closed).toMatchObject({ status: "APPROVED", decidedById: admin.id });
    await expect(approveDeletionRequest(admin, { requestId: req.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const back = await loginWithGoogle({
      sub: "g-123",
      email: "back@example.in",
      name: "Back Again",
      picture: null,
    });
    expect(back.isNew).toBe(true);
    expect(back.id).not.toBe(u.id);

    const { pending, decided } = await listDeletionRequests(admin);
    expect(pending).toHaveLength(0);
    expect(decided[0]).toMatchObject({ id: req.id, status: "APPROVED" });
  });

  it("approval is refused (and the request stays pending) while the player captains a team", async () => {
    const u = await createPlayer();
    await testDb().team.create({
      data: {
        game: "FREE_FIRE",
        name: "Alpha",
        captainId: u.id,
        members: { create: { userId: u.id, game: "FREE_FIRE", status: "CONFIRMED" } },
      },
    });
    const req = await requestAccountDeletion(player(u), {});
    await expect(approveDeletionRequest(admin, { requestId: req.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("captain"),
    });
    expect(
      (await testDb().accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
    ).toBe("PENDING");
  });

  it("declining keeps the account and notifies the player with the note", async () => {
    const u = await createPlayer();
    const req = await requestAccountDeletion(player(u), {});
    await rejectDeletionRequest(admin, { requestId: req.id, note: "You have a prize coming" });

    expect((await testDb().user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toBeNull();
    expect(
      await testDb().accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } }),
    ).toMatchObject({
      status: "REJECTED",
      adminNote: "You have a prize coming",
      decidedById: admin.id,
    });
    const note = await testDb().notification.findFirst({ where: { userId: u.id } });
    expect(note?.body).toContain("You have a prize coming");
    // A new request can be sent after a decline.
    const next = await requestAccountDeletion(player(u), {});
    expect(next.id).not.toBe(req.id);
  });
});
