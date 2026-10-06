import { beforeEach, describe, expect, it } from "vitest";
import { getMyMatches } from "@/server/queries/matches";
import { listRegisteredTeams, listTeamRegistrationEvents } from "@/server/services/admin-teams";
import { createTeam, joinTeamByCode } from "@/server/services/teams";
import { applyTransition } from "@/server/services/match-status";
import { cancelRegistration, registerForMatch, respondToRoster } from "@/server/services/registration";
import type { Actor } from "@/lib/roles";
import { addMinutes } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

let adminId: string;
const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });

async function statusOf(matchId: string, userId: string) {
  return (await testDb().registration.findUnique({ where: { matchId_userId: { matchId, userId } } }))?.status;
}

beforeEach(async () => {
  await resetDb();
  adminId = (await createUser({ role: "ADMIN" })).id;
});

describe("guards and validation", () => {
  it("requires login for every registration mutation", async () => {
    await expect(registerForMatch(null, { matchId: "m" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(respondToRoster(null, { matchId: "m", accept: true })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(cancelRegistration(null, { matchId: "m" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("validates input", async () => {
    const p = await createPlayer();
    await expect(registerForMatch(actor(p), {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(respondToRoster(actor(p), { matchId: "m", accept: "yes" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(cancelRegistration(actor(p), { matchId: 5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registerForMatch(actor(p), { matchId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("solo registration rules", () => {
  it("requires a complete profile with an ID for the match's game", async () => {
    const m = await createMatch(adminId, { game: "BGMI" });
    const ffOnly = await createPlayer("FREE_FIRE");
    await expect(registerForMatch(actor(ffOnly), { matchId: m.id })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      fieldErrors: { missing: ["BGMI Character ID"] },
    });
    const noDob = await createPlayer("BGMI", { dateOfBirth: null });
    await expect(registerForMatch(actor(noDob), { matchId: m.id })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      fieldErrors: { missing: ["date of birth"] },
    });
  });

  it("requires a verified email (updates go out by email)", async () => {
    const m = await createMatch(adminId, { game: "BGMI" });
    const noEmail = await createPlayer("BGMI", { email: null });
    await expect(registerForMatch(actor(noEmail), { matchId: m.id })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      fieldErrors: { missing: ["verified email"] },
    });
  });

  it("requires the exact in-game name next to a Free Fire UID", async () => {
    const m = await createMatch(adminId, { game: "FREE_FIRE" });
    const noName = await createUser({ games: [{ game: "FREE_FIRE", gameId: "44556677" }] });
    await expect(registerForMatch(actor(noName), { matchId: m.id })).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      fieldErrors: { missing: ["Free Fire in-game name"] },
    });
  });

  it("rejects banned and strike-blocked players", async () => {
    const m = await createMatch(adminId);
    const banned = await createPlayer();
    await testDb().user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
    await expect(registerForMatch(actor(banned), { matchId: m.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const struck = await createPlayer();
    await testDb().user.update({ where: { id: struck.id }, data: { strikes: 3, registrationBlockedUntil: addMinutes(new Date(), 60) } });
    await expect(registerForMatch(actor(struck), { matchId: m.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects matches that are not open, closed by time, or paid", async () => {
    const p = await createPlayer();
    const upcoming = await createMatch(adminId, { status: "UPCOMING" });
    await expect(registerForMatch(actor(p), { matchId: upcoming.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const soon = await createMatch(adminId, { startsAt: addMinutes(new Date(), 20) }); // closes 30 min before start
    await expect(registerForMatch(actor(p), { matchId: soon.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Late joins"),
    });
    const paid = await createMatch(adminId, { entryFeePaise: 5000 });
    await expect(registerForMatch(actor(p), { matchId: paid.id })).rejects.toMatchObject({
      message: expect.stringContaining("coming soon"),
    });
  });

  it("confirms until slots are full, then waitlists; no double registration", async () => {
    const m = await createMatch(adminId, { maxSlots: 2, capped: true });
    const [a, b, c, d] = await Promise.all([createPlayer(), createPlayer(), createPlayer(), createPlayer()]);
    expect((await registerForMatch(actor(a), { matchId: m.id })).status).toBe("CONFIRMED");
    expect((await registerForMatch(actor(b), { matchId: m.id })).status).toBe("CONFIRMED");
    expect((await registerForMatch(actor(c), { matchId: m.id })).status).toBe("WAITLISTED");
    expect((await registerForMatch(actor(d), { matchId: m.id })).status).toBe("WAITLISTED");
    await expect(registerForMatch(actor(a), { matchId: m.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancelling a confirmed slot promotes the first waitlisted player", async () => {
    const m = await createMatch(adminId, { maxSlots: 1, capped: true });
    const [a, b, c] = await Promise.all([createPlayer(), createPlayer(), createPlayer()]);
    await registerForMatch(actor(a), { matchId: m.id });
    await registerForMatch(actor(b), { matchId: m.id });
    await registerForMatch(actor(c), { matchId: m.id });
    await cancelRegistration(actor(a), { matchId: m.id });
    expect(await statusOf(m.id, a.id)).toBe("CANCELLED");
    expect(await statusOf(m.id, b.id)).toBe("CONFIRMED");
    expect(await statusOf(m.id, c.id)).toBe("WAITLISTED");
  });

  it("cancelling from the waitlist does not promote anyone", async () => {
    const m = await createMatch(adminId, { maxSlots: 1, capped: true });
    const [a, b, c] = await Promise.all([createPlayer(), createPlayer(), createPlayer()]);
    for (const p of [a, b, c]) await registerForMatch(actor(p), { matchId: m.id });
    await cancelRegistration(actor(b), { matchId: m.id });
    expect(await statusOf(m.id, a.id)).toBe("CONFIRMED");
    expect(await statusOf(m.id, c.id)).toBe("WAITLISTED");
  });

  it("allows cancelling only until registration closes, and re-registering after cancelling", async () => {
    const m = await createMatch(adminId, { maxSlots: 5 });
    const p = await createPlayer();
    await registerForMatch(actor(p), { matchId: m.id });
    await cancelRegistration(actor(p), { matchId: m.id });
    expect((await registerForMatch(actor(p), { matchId: m.id })).status).toBe("CONFIRMED");
    await expect(cancelRegistration(actor(p), { matchId: m.id }, addMinutes(m.registrationClosesAt, 1))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const stranger = await createPlayer();
    await expect(cancelRegistration(actor(stranger), { matchId: m.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the last-slot race", () => {
  it("yields exactly one CONFIRMED and one WAITLISTED", async () => {
    for (let round = 0; round < 5; round++) {
      const m = await createMatch(adminId, { maxSlots: 2, capped: true });
      const holder = await createPlayer();
      await registerForMatch(actor(holder), { matchId: m.id });
      const [x, y] = await Promise.all([createPlayer(), createPlayer()]);
      const results = await Promise.all([registerForMatch(actor(x), { matchId: m.id }), registerForMatch(actor(y), { matchId: m.id })]);
      expect(results.map((r) => r.status).sort()).toEqual(["CONFIRMED", "WAITLISTED"]);
      expect(await testDb().registration.count({ where: { matchId: m.id, status: "CONFIRMED" } })).toBe(2);
    }
  });
});

describe("captain-entered roster (teammates need no account)", () => {
  const squad = (players: { gameId: string; ign?: string }[], teamName = "Night Owls") => ({
    teamName,
    players,
  });
  const three = [
    { gameId: "70000001", ign: "Owl ONE" },
    { gameId: "70000002", ign: "ÐΞΛTH々2" },
    { gameId: "70000003", ign: "owl three" },
  ];

  it("confirms the squad at once, keeping every exact in-game name", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const r = await registerForMatch(actor(cap), { matchId: m.id, ...squad(three) });
    expect(r.status).toBe("CONFIRMED");
    const reg = await testDb().registration.findUniqueOrThrow({
      where: { id: r.registrationId },
      include: { members: { orderBy: { gameId: "asc" } } },
    });
    expect(reg).toMatchObject({ teamName: "Night Owls", teamId: null });
    expect(reg.members.map((x) => [x.gameId, x.ign, x.status])).toEqual(
      expect.arrayContaining([
        ["70000001", "Owl ONE", "CONFIRMED"],
        ["70000002", "ÐΞΛTH々2", "CONFIRMED"],
        ["70000003", "owl three", "CONFIRMED"],
      ]),
    );
    expect(reg.members).toHaveLength(4); // captain included
    expect(reg.members.find((x) => x.userId === cap.id)).toBeTruthy();
  });

  it("shows the registered team to staff on the admin Teams list (IGL first)", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    await registerForMatch(actor(cap), { matchId: m.id, ...squad(three) });
    await expect(listRegisteredTeams(actor(cap), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listRegisteredTeams(null, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const staff: Actor = { id: adminId, role: "ADMIN" };
    const [row] = await listRegisteredTeams(staff, { game: "BGMI", q: "night" });
    expect(row).toMatchObject({ teamName: "Night Owls", status: "CONFIRMED", igl: { id: cap.id } });
    expect(row?.match).toMatchObject({ id: m.id, kindLabel: "Scrim", name: "Test match" });
    // The Teams page lists events first, with how many teams registered.
    await expect(listTeamRegistrationEvents(actor(cap), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listTeamRegistrationEvents(staff, { game: "BGMI" })).toEqual([
      expect.objectContaining({ id: m.id, entries: 1, teamMode: true, kindLabel: "Scrim", name: "Test match" }),
    ]);
    expect(await listTeamRegistrationEvents(staff, { game: "VALORANT" })).toEqual([]);
    expect(await listRegisteredTeams(staff, { matchId: m.id })).toHaveLength(1);
    expect(row?.players).toHaveLength(4);
    expect(row?.players[0]?.igl).toBe(true);
    expect(row?.players.map((p) => p.ign)).toEqual(expect.arrayContaining(["Owl ONE", "ÐΞΛTH々2", "owl three"]));
    expect(await listRegisteredTeams(staff, { game: "VALORANT" })).toHaveLength(0);
    expect(await listRegisteredTeams(staff, { q: "zzz" })).toHaveLength(0);
  });

  it("lists solo entries too, with the player's own game ID", async () => {
    const m = await createMatch(adminId, { game: "FREE_FIRE", mode: "SOLO", title: "Solo Rush" });
    const p = await createPlayer("FREE_FIRE", { displayName: "Lone Wolf" });
    await registerForMatch(actor(p), { matchId: m.id });
    const staff: Actor = { id: adminId, role: "ADMIN" };
    expect(await listTeamRegistrationEvents(staff, { game: "FREE_FIRE" })).toEqual([
      expect.objectContaining({ id: m.id, entries: 1, teamMode: false, name: "Solo Rush" }),
    ]);
    const [row] = await listRegisteredTeams(staff, { matchId: m.id });
    const profile = await testDb().gameProfile.findUniqueOrThrow({
      where: { userId_game: { userId: p.id, game: "FREE_FIRE" } },
    });
    expect(row).toMatchObject({ team: false, teamName: "Lone Wolf" });
    expect(row?.players).toEqual([
      expect.objectContaining({ gameId: profile.gameId, ign: "Exact Ign", igl: false }),
    ]);
    // Search finds a player by name as well as a team.
    expect(await listRegisteredTeams(staff, { q: "lone" })).toHaveLength(1);
  });

  it("fills the roster from the player's saved team and links the registration to it", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const team = await createTeam(actor(cap), { game: "BGMI", name: "Saved Squad" });
    const mates = [await createPlayer("BGMI"), await createPlayer("BGMI"), await createPlayer("BGMI")];
    for (const p of mates) await joinTeamByCode(actor(p), { code: team.joinCode });
    const profiles = await testDb().gameProfile.findMany({
      where: { userId: { in: mates.map((p) => p.id) }, game: "BGMI" },
    });
    const r = await registerForMatch(actor(mates[0]!), {
      matchId: m.id,
      teamId: team.id,
      teamName: "ignored",
      players: profiles
        .filter((p) => p.userId !== mates[0]!.id)
        .concat([
          (await testDb().gameProfile.findUniqueOrThrow({
            where: { userId_game: { userId: cap.id, game: "BGMI" } },
          }))!,
        ])
        .map((p) => ({ gameId: p.gameId, ign: p.ign ?? "" })),
    });
    // Any member may register the team; the one who registers is the IGL.
    expect(r.status).toBe("CONFIRMED");
    const reg = await testDb().registration.findUniqueOrThrow({
      where: { id: r.registrationId },
      include: { members: true },
    });
    expect(reg).toMatchObject({ teamId: team.id, teamName: "Saved Squad", userId: mates[0]!.id });
    expect(reg.members.map((x) => x.userId).sort()).toEqual([cap.id, ...mates.map((p) => p.id)].sort());

    // Someone else's team can't be used.
    const m2 = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const outsider = await createPlayer("BGMI");
    await expect(
      registerForMatch(actor(outsider), { matchId: m2.id, teamId: team.id, players: squad(three).players }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { teamId: expect.any(Array) } });
  });

  it("shows a tournament sign-up on the player's dashboard", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 16, capped: true });
    await testDb().match.update({ where: { id: m.id }, data: { isEntryList: true } });
    const cap = await createPlayer("BGMI");
    await registerForMatch(actor(cap), { matchId: m.id, ...squad(three) });
    const mine = await getMyMatches(cap.id);
    expect(mine).toEqual([
      expect.objectContaining({
        teamName: "Night Owls",
        match: expect.objectContaining({ id: m.id, isEntryList: true, tournament: expect.objectContaining({ title: "Capacity test" }) }),
      }),
    ]);
  });

  it("validates the roster: size, ID format, exact name, duplicates and team name", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const cap = await createPlayer("BGMI");
    const go = (input: object) => registerForMatch(actor(cap), { matchId: m.id, ...input });
    await expect(go(squad(three.slice(0, 2)))).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { players: expect.any(Array) } });
    await expect(go(squad([three[0]!, three[1]!, { gameId: "12ab", ign: "X" }]))).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "players.2": expect.any(Array) },
    });
    await expect(go(squad([three[0]!, three[1]!, { gameId: "70000009" }]))).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "players.2": expect.any(Array) },
    });
    await expect(go(squad([three[0]!, three[0]!, three[2]!]))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(go(squad(three, "x"))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a banned game ID and a player already in another team of the match", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    await testDb().ban.create({ data: { game: "BGMI", gameId: "70000003", reason: "Cheating" } });
    await expect(
      registerForMatch(actor(await createPlayer("BGMI")), { matchId: m.id, ...squad(three) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await testDb().ban.deleteMany();

    await registerForMatch(actor(await createPlayer("BGMI")), { matchId: m.id, ...squad(three) });
    const other = [{ gameId: "70000001", ign: "Owl ONE" }, { gameId: "71000002", ign: "B" }, { gameId: "71000003", ign: "C" }];
    await expect(
      registerForMatch(actor(await createPlayer("BGMI")), { matchId: m.id, ...squad(other, "Second") }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("links a teammate who has an account with that ID (they get notified and can see the room)", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 25 });
    const mate = await createUser({ games: [{ game: "BGMI", gameId: "70000002", ign: "ÐΞΛTH々2" }] });
    const cap = await createPlayer("BGMI");
    await registerForMatch(actor(cap), { matchId: m.id, ...squad(three) });
    const row = await testDb().registrationMember.findFirstOrThrow({ where: { matchId: m.id, gameId: "70000002" } });
    expect(row.userId).toBe(mate.id);
    expect(await testDb().notification.count({ where: { userId: mate.id, type: "REGISTRATION_CONFIRMED" } })).toBe(1);
    const { isConfirmedPlayer } = await import("@/server/services/registration");
    expect(await isConfirmedPlayer(m.id, mate.id)).toBe(true);
  });
});

describe("squad registration", () => {
  async function squad(size = 4, game: "BGMI" | "VALORANT" = "BGMI") {
    const players = await Promise.all(Array.from({ length: size + 1 }, () => createPlayer(game)));
    const [captain, ...rest] = players;
    const team = await testDb().team.create({
      data: {
        game,
        name: `Squad ${captain!.id.slice(-5)}`,
        captainId: captain!.id,
        members: { create: players.map((p) => ({ userId: p.id, game, status: "CONFIRMED" as const })) },
      },
    });
    return { team, captain: captain!, members: rest.slice(0, size - 1), bench: rest[size - 1]! };
  }

  it("stays PENDING until every member confirms, then CONFIRMED", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 4 });
    const { team, captain, members } = await squad();
    const r = await registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: members.map((x) => x.id) });
    expect(r.status).toBe("PENDING");
    expect(await testDb().registration.count({ where: { matchId: m.id, status: "CONFIRMED" } })).toBe(0);
    expect(await respondToRoster(actor(members[0]!), { matchId: m.id, accept: true })).toBe("PENDING");
    expect(await respondToRoster(actor(members[1]!), { matchId: m.id, accept: true })).toBe("PENDING");
    expect(await respondToRoster(actor(members[2]!), { matchId: m.id, accept: true })).toBe("CONFIRMED");
    expect(await statusOf(m.id, captain.id)).toBe("CONFIRMED");
    await expect(respondToRoster(actor(members[0]!), { matchId: m.id, accept: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is WAITLISTED if the match fills before the last member confirms", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 2, capped: true });
    const s1 = await squad();
    const s2 = await squad();
    const s3 = await squad();
    for (const s of [s1, s2, s3]) {
      await registerForMatch(actor(s.captain), { matchId: m.id, teamId: s.team.id, memberIds: s.members.map((x) => x.id) });
    }
    // s3 confirms first, then s1, then s2 (fills after the match is full).
    for (const s of [s3, s1, s2]) for (const x of s.members) await respondToRoster(actor(x), { matchId: m.id, accept: true });
    expect(await statusOf(m.id, s3.captain.id)).toBe("CONFIRMED");
    expect(await statusOf(m.id, s1.captain.id)).toBe("CONFIRMED");
    expect(await statusOf(m.id, s2.captain.id)).toBe("WAITLISTED");
    // Captain of a confirmed squad cancels: the waitlisted squad is promoted.
    await cancelRegistration(actor(s1.captain), { matchId: m.id });
    expect(await statusOf(m.id, s2.captain.id)).toBe("CONFIRMED");
  });

  it("a decline cancels the squad registration and frees everyone", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 4 });
    const { team, captain, members, bench } = await squad();
    await registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: members.map((x) => x.id) });
    expect(await respondToRoster(actor(members[1]!), { matchId: m.id, accept: false })).toBe("DECLINED");
    expect(await statusOf(m.id, captain.id)).toBe("CANCELLED");
    // Captain re-registers with the bench player instead.
    const r = await registerForMatch(actor(captain), {
      matchId: m.id,
      teamId: team.id,
      memberIds: [members[0]!.id, members[2]!.id, bench.id],
    });
    expect(r.status).toBe("PENDING");
  });

  it("enforces captain, roster size, membership and one squad per player", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 4 });
    const { team, captain, members, bench } = await squad();
    const ids = members.map((x) => x.id);
    await expect(registerForMatch(actor(members[0]!), { matchId: m.id, teamId: team.id, memberIds: [captain.id, ...ids.slice(1), bench.id] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: ids.slice(0, 2) })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(registerForMatch(actor(captain), { matchId: m.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const outsider = await createPlayer("BGMI");
    await expect(
      registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: [...ids.slice(0, 2), outsider.id] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // A player already registered solo... cannot also be on a squad roster for the same match.
    const solo = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 4 });
    await registerForMatch(actor(captain), { matchId: solo.id, teamId: team.id, memberIds: ids });
    const other = await squad();
    await testDb().teamMember.create({ data: { teamId: other.team.id, userId: members[0]!.id, game: "BGMI", status: "CONFIRMED" } });
    await expect(
      registerForMatch(actor(other.captain), {
        matchId: solo.id,
        teamId: other.team.id,
        memberIds: [members[0]!.id, other.members[0]!.id, other.members[1]!.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("closing registration cancels squads that never fully confirmed", async () => {
    const m = await createMatch(adminId, { game: "BGMI", mode: "SQUAD", maxSlots: 4 });
    const { team, captain, members } = await squad();
    await registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: members.map((x) => x.id) });
    await testDb().$transaction((tx) => applyTransition(tx, m.id, "REGISTRATION_OPEN", "REGISTRATION_CLOSED", { actorId: null }));
    expect(await statusOf(m.id, captain.id)).toBe("CANCELLED");
    expect(await testDb().registrationMember.count({ where: { matchId: m.id } })).toBe(0);
  });

  it("needs 5 players for Valorant 5v5", async () => {
    const m = await createMatch(adminId, { game: "VALORANT", mode: "FIVE_V_FIVE", maxSlots: 2 });
    const { team, captain, members } = await squad(5, "VALORANT");
    const r = await registerForMatch(actor(captain), { matchId: m.id, teamId: team.id, memberIds: members.map((x) => x.id) });
    expect(r.status).toBe("PENDING");
    expect(await testDb().registrationMember.count({ where: { registrationId: r.registrationId } })).toBe(5);
  });
});
