import { beforeEach, describe, expect, it } from "vitest";
import { getRegisteredEntries } from "@/server/queries/matches";
import { getPublicTeam, isPlausibleId } from "@/server/queries/teams";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
});

async function teamWith() {
  const captain = await createPlayer("FREE_FIRE", { displayName: "Cap" });
  const mate = await createPlayer("FREE_FIRE", { displayName: "Mate" });
  const invited = await createPlayer("FREE_FIRE", { displayName: "Invitee" });
  const team = await testDb().team.create({
    data: {
      game: "FREE_FIRE",
      name: "Wolves",
      captainId: captain.id,
      members: {
        create: [
          { userId: captain.id, game: "FREE_FIRE", status: "CONFIRMED", confirmedAt: new Date() },
          { userId: mate.id, game: "FREE_FIRE", status: "CONFIRMED", confirmedAt: new Date() },
          { userId: invited.id, game: "FREE_FIRE", status: "INVITED" },
        ],
      },
    },
  });
  return { team, captain, mate };
}

describe("getPublicTeam", () => {
  it("returns null for junk and unknown ids", async () => {
    expect(isPlausibleId("../../etc")).toBe(false);
    expect(await getPublicTeam("not a valid id!")).toBeNull();
    expect(await getPublicTeam("cmzzzzzzzzzzzzzzzzzzzzzzz")).toBeNull();
  });

  it("shows confirmed members and approved results, never phones or game IDs", async () => {
    const { team, captain } = await teamWith();
    const m = await createMatch(captain.id, { status: "COMPLETED", mode: "SQUAD", title: "Night" });
    const reg = await testDb().registration.create({
      data: { matchId: m.id, userId: captain.id, teamId: team.id, status: "CONFIRMED", position: 1 },
    });
    await testDb().result.create({
      data: { matchId: m.id, registrationId: reg.id, teamId: team.id, placement: 2, kills: 7, approvedAt: new Date() },
    });
    const view = await getPublicTeam(team.id);
    expect(view!.members.map((x) => x.displayName).sort()).toEqual(["Cap", "Mate"]);
    expect(view!.results).toHaveLength(1);
    expect(view!.results[0]).toMatchObject({ placement: 2, kills: 7 });
    const json = JSON.stringify(view);
    expect(json).not.toContain(captain.phone);
    expect(json).not.toContain(captain.gameProfiles[0]!.gameId);
  });
});

describe("getRegisteredEntries", () => {
  it("lists confirmed entries by name with links and counts the waitlist", async () => {
    const { team, captain } = await teamWith();
    const admin = await createUser({ role: "ADMIN" });
    const solo = await createPlayer("FREE_FIRE", { displayName: "Solo" });
    const waiting = await createPlayer();
    const m = await createMatch(admin.id);
    await testDb().registration.createMany({
      data: [
        { matchId: m.id, userId: captain.id, teamId: team.id, status: "CONFIRMED", position: 1 },
        { matchId: m.id, userId: solo.id, status: "CONFIRMED", position: 2 },
        { matchId: m.id, userId: waiting.id, status: "WAITLISTED", position: 3 },
      ],
    });
    const { entries, waitlisted } = await getRegisteredEntries(m.id);
    expect(entries.map((e) => [e.name, e.href])).toEqual([
      ["Wolves", `/teams/${team.id}`],
      ["Solo", `/players/${solo.id}`],
    ]);
    expect(waitlisted).toBe(1);
    expect(JSON.stringify(entries)).not.toContain(solo.phone);
  });
});
