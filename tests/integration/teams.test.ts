import { beforeEach, describe, expect, it } from "vitest";
import {
  createTeam,
  findTeamByCode,
  getMyTeams,
  inviteToTeam,
  joinTeamByCode,
  leaveTeam,
  removeTeamMember,
  respondToTeamInvite,
  transferCaptaincy,
} from "@/server/services/teams";
import type { Actor } from "@/lib/roles";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

beforeEach(async () => {
  await resetDb();
});

async function gameIdOf(userId: string, game: "BGMI" | "VALORANT" | "FREE_FIRE") {
  return (await testDb().gameProfile.findUniqueOrThrow({ where: { userId_game: { userId, game } } })).gameId;
}

describe("join codes (DECISIONS M17)", () => {
  it("gives every new team a unique 5-letter code", async () => {
    const codes = new Set<string>();
    for (const game of ["BGMI", "VALORANT", "FREE_FIRE"] as const) {
      const cap = await createPlayer(game);
      const t = await createTeam(actor(cap), { game, name: `Code ${game}` });
      expect(t.joinCode).toMatch(/^[A-HJ-NP-Z]{5}$/);
      codes.add(t.joinCode);
    }
    expect(codes.size).toBe(3);
  });

  it("finds a team by code (any case) and joins it directly", async () => {
    const cap = await createPlayer("BGMI");
    const t = await createTeam(actor(cap), { game: "BGMI", name: "Night Owls" });
    const p = await createPlayer("BGMI");
    const found = await findTeamByCode(actor(p), { code: ` ${t.joinCode.toLowerCase()} ` });
    expect(found).toMatchObject({ name: "Night Owls", game: "BGMI", members: 1 });
    await joinTeamByCode(actor(p), { code: t.joinCode });
    const { teams } = await getMyTeams(p.id);
    expect(teams.map((x) => x.id)).toEqual([t.id]);
    await expect(joinTeamByCode(actor(p), { code: t.joinCode })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "You are already in this team.",
    });
  });

  it("needs the team game's ID, a real code, and no other team for that game", async () => {
    const cap = await createPlayer("VALORANT");
    const t = await createTeam(actor(cap), { game: "VALORANT", name: "Radiant" });
    const ffOnly = await createPlayer("FREE_FIRE");
    await expect(joinTeamByCode(actor(ffOnly), { code: t.joinCode })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
    });
    await expect(findTeamByCode(actor(ffOnly), { code: "AB" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(findTeamByCode(actor(ffOnly), { code: "I0I0I" })).rejects.toMatchObject({ code: "VALIDATION" });
    const unused = t.joinCode === "ZZZZZ" ? "YYYYY" : "ZZZZZ";
    await expect(findTeamByCode(actor(ffOnly), { code: unused })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const other = await createPlayer("VALORANT");
    await createTeam(actor(other), { game: "VALORANT", name: "Other Side" });
    await expect(joinTeamByCode(actor(other), { code: t.joinCode })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Other Side"),
    });
  });

  it("refuses a player who is already in a team, even for another game", async () => {
    const cap = await createPlayer("BGMI");
    const t = await createTeam(actor(cap), { game: "BGMI", name: "Squad Up" });
    const p = await createUser({
      games: [
        { game: "BGMI", gameId: "5188800001", ign: "Both" },
        { game: "VALORANT", gameId: "both#1111", ign: "Both#1111", region: "AP" },
      ],
    });
    await createTeam(actor(p), { game: "VALORANT", name: "Val Side" });
    await expect(joinTeamByCode(actor(p), { code: t.joinCode })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Val Side"),
    });
  });

  it("refuses a full team", async () => {
    const cap = await createPlayer("BGMI");
    const t = await createTeam(actor(cap), { game: "BGMI", name: "Packed" });
    let joined = 1;
    for (;;) {
      const p = await createPlayer("BGMI");
      try {
        await joinTeamByCode(actor(p), { code: t.joinCode });
        joined++;
      } catch (e) {
        expect(e).toMatchObject({ code: "CONFLICT", message: expect.stringContaining("full") });
        break;
      }
      expect(joined).toBeLessThan(20);
    }
    expect(joined).toBeGreaterThanOrEqual(4);
  });
});

describe("team names", () => {
  it("are unique per game ignoring case: CSK and csk can't both exist, and a double create makes one team", async () => {
    const a = await createPlayer("BGMI");
    const b = await createPlayer("BGMI");
    await createTeam(actor(a), { game: "BGMI", name: "CSK" });
    await expect(createTeam(actor(b), { game: "BGMI", name: "csk" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // The same player pressing Create twice at once: still one team.
    const c = await createPlayer("BGMI");
    const results = await Promise.allSettled([
      createTeam(actor(c), { game: "BGMI", name: "Mumbai Kings" }),
      createTeam(actor(c), { game: "BGMI", name: "Mumbai Kings" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await testDb().team.count({ where: { name: "Mumbai Kings" } })).toBe(1);
    // Two different names at once from the same player: still only one team.
    const d = await createPlayer("BGMI");
    await Promise.allSettled([
      createTeam(actor(d), { game: "BGMI", name: "Delhi One" }),
      createTeam(actor(d), { game: "BGMI", name: "Delhi Two" }),
    ]);
    expect(await testDb().team.count({ where: { captainId: d.id } })).toBe(1);
  });
});

describe("team guards", () => {
  it("requires login for every team mutation", async () => {
    for (const call of [
      () => findTeamByCode(null, { code: "ABCDE" }),
      () => joinTeamByCode(null, { code: "ABCDE" }),
      () => createTeam(null, { game: "BGMI", name: "Alpha" }),
      () => inviteToTeam(null, { teamId: "t", gameId: "123456" }),
      () => respondToTeamInvite(null, { teamId: "t", accept: true }),
      () => leaveTeam(null, { teamId: "t" }),
      () => removeTeamMember(null, { teamId: "t", userId: "u" }),
      () => transferCaptaincy(null, { teamId: "t", userId: "u" }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });
});

describe("teams", () => {
  it("creates a team per game for players with that game's ID; names are unique per game", async () => {
    const cap = await createPlayer("BGMI");
    await expect(createTeam(actor(cap), { game: "BGMI", name: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createTeam(actor(cap), { game: "VALORANT", name: "Alpha" })).rejects.toMatchObject({ code: "PROFILE_INCOMPLETE" });
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Alpha" });
    await expect(createTeam(actor(cap), { game: "BGMI", name: "Beta" })).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await createPlayer("BGMI");
    await expect(createTeam(actor(other), { game: "BGMI", name: "Alpha" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getMyTeams(cap.id)).teams.map((t) => t.id)).toEqual([team.id]);
  });

  it("invites by game ID; only the captain may invite; one team per game", async () => {
    const cap = await createPlayer("BGMI");
    const mate = await createPlayer("BGMI");
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Alpha" });
    await expect(inviteToTeam(actor(mate), { teamId: team.id, gameId: await gameIdOf(mate.id, "BGMI") })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(inviteToTeam(actor(cap), { teamId: team.id, gameId: "999999999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(mate.id, "BGMI") });
    await expect(inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(mate.id, "BGMI") })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await getMyTeams(mate.id)).invites.map((t) => t.id)).toEqual([team.id]);

    // mate joins another team first -> cannot accept Alpha
    const cap2 = await createPlayer("BGMI");
    const team2 = await createTeam(actor(cap2), { game: "BGMI", name: "Bravo" });
    await inviteToTeam(actor(cap2), { teamId: team2.id, gameId: await gameIdOf(mate.id, "BGMI") });
    await respondToTeamInvite(actor(mate), { teamId: team2.id, accept: true });
    await expect(respondToTeamInvite(actor(mate), { teamId: team.id, accept: true })).rejects.toMatchObject({ code: "CONFLICT" });
    await respondToTeamInvite(actor(mate), { teamId: team.id, accept: false });
    expect((await getMyTeams(mate.id)).invites).toEqual([]);
  });

  it("finds Valorant players by Riot ID regardless of case and refuses banned players", async () => {
    const cap = await createPlayer("VALORANT");
    const mate = await createUser({ games: [{ game: "VALORANT", gameId: "ace one#ind", ign: "Ace One#IND", region: "AP" }] });
    const team = await createTeam(actor(cap), { game: "VALORANT", name: "Vipers" });
    await inviteToTeam(actor(cap), { teamId: team.id, gameId: "ACE ONE#ind" });
    const banned = await createUser({ games: [{ game: "VALORANT", gameId: "bad guy#666", ign: "Bad Guy#666", region: "AP" }] });
    await testDb().user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
    await expect(inviteToTeam(actor(cap), { teamId: team.id, gameId: "Bad Guy#666" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await testDb().teamMember.count({ where: { teamId: team.id, userId: mate.id } })).toBe(1);
  });

  it("caps team size at squad size + 3 (including invites)", async () => {
    const cap = await createPlayer("BGMI");
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Full" });
    for (let i = 0; i < 6; i++) {
      const p = await createPlayer("BGMI");
      await inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(p.id, "BGMI") });
    }
    const extra = await createPlayer("BGMI");
    await expect(inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(extra.id, "BGMI") })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("captain removes members and hands over captaincy; leaving rules", async () => {
    const cap = await createPlayer("BGMI");
    const mate = await createPlayer("BGMI");
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Alpha" });
    await inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(mate.id, "BGMI") });
    await respondToTeamInvite(actor(mate), { teamId: team.id, accept: true });

    await expect(leaveTeam(actor(cap), { teamId: team.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeTeamMember(actor(mate), { teamId: team.id, userId: cap.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeTeamMember(actor(cap), { teamId: team.id, userId: cap.id })).rejects.toMatchObject({ code: "VALIDATION" });

    await transferCaptaincy(actor(cap), { teamId: team.id, userId: mate.id });
    expect((await testDb().team.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(mate.id);
    await removeTeamMember(actor(mate), { teamId: team.id, userId: cap.id });
    await expect(removeTeamMember(actor(mate), { teamId: team.id, userId: cap.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A lone captain leaving deletes the team.
    await leaveTeam(actor(mate), { teamId: team.id });
    expect(await testDb().team.count()).toBe(0);
  });

  it("handing over captaincy moves upcoming entries; removed members leave upcoming rosters", async () => {
    const cap = await createPlayer("BGMI");
    const mate = await createPlayer("BGMI");
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Bravo" });
    await inviteToTeam(actor(cap), { teamId: team.id, gameId: await gameIdOf(mate.id, "BGMI") });
    await respondToTeamInvite(actor(mate), { teamId: team.id, accept: true });
    const admin = await createUser({ role: "ADMIN" });
    const m = await createMatch(admin.id, { game: "BGMI", mode: "SQUAD", status: "REGISTRATION_OPEN" });
    const reg = await testDb().registration.create({
      data: { matchId: m.id, userId: cap.id, teamId: team.id, status: "CONFIRMED", position: 1 },
    });
    await testDb().registrationMember.createMany({
      data: [cap, mate].map((p) => ({ registrationId: reg.id, matchId: m.id, userId: p.id, status: "CONFIRMED" as const })),
    });

    await transferCaptaincy(actor(cap), { teamId: team.id, userId: mate.id });
    expect((await testDb().registration.findUniqueOrThrow({ where: { id: reg.id } })).userId).toBe(mate.id);
    await removeTeamMember(actor(mate), { teamId: team.id, userId: cap.id });
    expect(await testDb().registrationMember.count({ where: { matchId: m.id, userId: cap.id } })).toBe(0);
  });
});
