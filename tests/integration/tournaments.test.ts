import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMatchStatusJob } from "@/server/jobs/match-status-job";
import { registerForMatch } from "@/server/services/registration";
import { approveResults, reopenResults, saveResultRows } from "@/server/services/results";
import {
  getCurrentTournaments,
  getTournamentLobbies,
  listPastTournaments,
  lobbyStandingsFor,
} from "@/server/services/tournament-queries";
import {
  addLobbyMatches,
  cancelTournament,
  createTournament,
  generateBracket,
  lockEntries,
  publishWinners,
  updateTournament,
} from "@/server/services/tournaments";
import { defaultPointsConfig } from "@/lib/points";
import type { Actor } from "@/lib/roles";
import { addDays, utcToIstInput } from "@/lib/time";
import { createPlayer, createUser, resetDb, testDb } from "../helpers/db";

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
}));

let admin: Actor;
let mod: Actor;

const inDays = (d: number, hhmm = "20:00") =>
  `${utcToIstInput(addDays(new Date(), d)).slice(0, 10)}T${hhmm}`;

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
  for (const game of ["BGMI", "VALORANT"] as const) {
    await testDb().season.create({
      data: {
        game,
        name: "S1",
        startsAt: addDays(new Date(), -1),
        endsAt: addDays(new Date(), 80),
        isActive: true,
      },
    });
    await testDb().pointsConfig.create({ data: { game, ...defaultPointsConfig(game) } });
  }
});

/** Register a confirmed team (with roster) on a tournament's sign-up list. */
async function enterTeam(
  entryMatchId: string,
  game: "BGMI" | "VALORANT",
  name: string,
  position: number,
) {
  const size = game === "VALORANT" ? 5 : 4;
  const players = await Promise.all(Array.from({ length: size }, () => createPlayer(game)));
  const team = await testDb().team.create({ data: { game, name, captainId: players[0]!.id } });
  const reg = await testDb().registration.create({
    data: {
      matchId: entryMatchId,
      userId: players[0]!.id,
      teamId: team.id,
      status: "CONFIRMED",
      position,
    },
  });
  await testDb().registrationMember.createMany({
    data: players.map((p) => ({
      registrationId: reg.id,
      matchId: entryMatchId,
      userId: p.id,
      status: "CONFIRMED" as const,
    })),
  });
  return { team, players };
}

async function toResultsPending(matchId: string) {
  await testDb().match.update({ where: { id: matchId }, data: { status: "RESULTS_PENDING" } });
}

describe("tournament admin guards and validation", () => {
  it("are admin-only", async () => {
    for (const call of [
      (a: Actor | null) => createTournament(a, {}),
      (a: Actor | null) => updateTournament(a, {}),
      (a: Actor | null) => addLobbyMatches(a, {}),
      (a: Actor | null) => lockEntries(a, {}),
      (a: Actor | null) => generateBracket(a, {}),
      (a: Actor | null) => publishWinners(a, {}),
      (a: Actor | null) => cancelTournament(a, {}),
    ]) {
      await expect(call(null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(call(mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("validates the form and allows one tournament per game, mode and week", async () => {
    await expect(
      createTournament(admin, {
        game: "BGMI",
        mode: "SQUAD",
        title: "X",
        startsAt: inDays(2),
        prizePool: "5000",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { title: expect.any(Array) } });
    // No max field: sign-ups are uncapped; maxSlots is one lobby (BGMI squads: 25).
    const t = await createTournament(admin, {
      game: "BGMI",
      mode: "SQUAD",
      title: "BGMI Cup",
      startsAt: inDays(2),
      prizePool: "5000",
    });
    expect(t).toMatchObject({ format: "LOBBY_POINTS", prizePoolPaise: 500000 });
    const entry = await testDb().match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    expect(entry).toMatchObject({
      isEntryList: true,
      status: "REGISTRATION_OPEN",
      maxSlots: 25,
      mode: "SQUAD",
      kind: "TOURNAMENT",
    });
    await expect(
      createTournament(admin, {
        game: "BGMI",
        mode: "SQUAD",
        title: "Second",
        startsAt: inDays(2, "21:00"),
        prizePool: "0",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "There is already a BGMI Squad tournament that week.",
    });
    // Another mode for the same game and week is fine.
    const solo = await createTournament(admin, {
      game: "BGMI",
      mode: "SOLO",
      title: "BGMI Solo Cup",
      startsAt: inDays(2, "18:00"),
      prizePool: "0",
    });
    expect(solo.mode).toBe("SOLO");
  });

  it("takes the mode from the form: head-to-head modes make a bracket of any size, modes must fit the game", async () => {
    await expect(
      createTournament(admin, {
        game: "VALORANT",
        mode: "SQUAD",
        title: "Val Cup",
        startsAt: inDays(2),
        prizePool: "0",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { mode: expect.any(Array) },
    });
    await expect(
      createTournament(admin, {
        game: "BGMI",
        mode: "FIVE_V_FIVE",
        title: "BGMI Cup",
        startsAt: inDays(2),
        prizePool: "0",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { mode: expect.any(Array) },
    });
    const t = await createTournament(admin, {
      game: "FREE_FIRE",
      mode: "ONE_V_ONE",
      title: "FF 1v1 Cup",
      startsAt: inDays(2),
      prizePool: "0",
    });
    expect(t).toMatchObject({ format: "BRACKET", mode: "ONE_V_ONE", bracketSize: null });
    const duo = await createTournament(admin, {
      game: "VALORANT",
      mode: "TWO_V_TWO",
      title: "Val 2v2",
      startsAt: inDays(2),
      prizePool: "0",
    });
    expect(duo).toMatchObject({ format: "BRACKET", mode: "TWO_V_TWO" });
    // Valorant Deathmatch (solo) is a lobby tournament of 10 (DECISIONS M50).
    const dm = await createTournament(admin, {
      game: "VALORANT",
      mode: "SOLO",
      title: "Val Deathmatch",
      startsAt: inDays(2),
      prizePool: "0",
    });
    expect(dm).toMatchObject({ format: "LOBBY_POINTS", mode: "SOLO" });
    const dmEntry = await testDb().match.findUniqueOrThrow({ where: { id: dm.entryMatchId! } });
    expect(dmEntry.maxSlots).toBe(10);
  });
});

/** Confirmed solo sign-ups straight in the database (registration itself is tested elsewhere). */
async function enterSolos(entryMatchId: string, game: "FREE_FIRE" | "VALORANT", count: number) {
  const players = [];
  for (let i = 0; i < count; i++) {
    const p = await createPlayer(game);
    await testDb().registration.create({
      data: { matchId: entryMatchId, userId: p.id, status: "CONFIRMED", position: i + 1 },
    });
    players.push(p);
  }
  return players;
}

describe("lobby tournaments (DECISIONS M50)", () => {
  it("takes unlimited sign-ups and splits 52 Free Fire solos into 26 + 26, the same lobby every match", async () => {
    const t = await createTournament(admin, {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "FF Solo Cup",
      startsAt: inDays(1),
      prizePool: "1000",
    });
    const players = await enterSolos(t.entryMatchId!, "FREE_FIRE", 51);
    // The 52nd player still gets a confirmed slot: one lobby holds 48, sign-ups are uncapped.
    const late = await createPlayer("FREE_FIRE");
    await registerForMatch({ id: late.id, role: "PLAYER" }, { matchId: t.entryMatchId! });
    expect(
      (await testDb().registration.findFirstOrThrow({ where: { userId: late.id } })).status,
    ).toBe("CONFIRMED");
    players.push(late);

    const matches = await addLobbyMatches(admin, {
      tournamentId: t.id,
      count: 2,
      firstStartsAt: inDays(1),
      gapMinutes: 45,
    });
    expect(await lockEntries(admin, { tournamentId: t.id })).toEqual({
      teams: 52,
      matches: 2,
      lobbies: 4,
    });
    // Idempotent.
    expect(await lockEntries(admin, { tournamentId: t.id })).toMatchObject({ lobbies: 4 });

    const lobbies = await testDb().match.findMany({
      where: { tournamentId: t.id, isEntryList: false },
      orderBy: [{ startsAt: "asc" }, { lobbyNumber: "asc" }],
      include: { registrations: { orderBy: { position: "asc" } } },
    });
    expect(lobbies.map((m) => [m.title, m.lobbyNumber, m.registrations.length, m.status])).toEqual([
      ["FF Solo Cup — Match 1 — Lobby 1", 1, 26, "REGISTRATION_CLOSED"],
      ["FF Solo Cup — Match 1 — Lobby 2", 2, 26, "REGISTRATION_CLOSED"],
      ["FF Solo Cup — Match 2 — Lobby 1", 1, 26, "REGISTRATION_CLOSED"],
      ["FF Solo Cup — Match 2 — Lobby 2", 2, 26, "REGISTRATION_CLOSED"],
    ]);
    expect(lobbies[1]!.parentMatchId).toBe(matches[0]!.id);
    expect(lobbies[3]!.parentMatchId).toBe(matches[1]!.id);
    // Same players in lobby 2 of both matches.
    const ids = (i: number) => lobbies[i]!.registrations.map((r) => r.userId).sort();
    expect(ids(1)).toEqual(ids(3));
    expect(ids(1)).toEqual(
      players
        .slice(26)
        .map((p) => p.id)
        .sort(),
    );

    // One bell per player: "You're in Lobby N", pointing at the first match's lobby.
    const notes = await testDb().notification.findMany({ where: { type: "TOURNAMENT_LOBBY" } });
    expect(notes).toHaveLength(52);
    expect(notes.find((n) => n.userId === players[51]!.id)?.title).toBe("You're in Lobby 2");

    // The tournament page lists each lobby once (not per match) and finds the viewer's lobby.
    const view = await getTournamentLobbies(t.id, players[51]!.id);
    expect(view.lobbies.map((l) => [l.lobby, l.names.length])).toEqual([
      [1, 26],
      [2, 26],
    ]);
    expect(view.mine).toBe(2);
    expect((await getTournamentLobbies(t.id, null)).mine).toBeNull();
  });

  it("closes registration from the status job and creates Match 1 when no match was added", async () => {
    const t = await createTournament(admin, {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "FF Auto Cup",
      startsAt: inDays(1),
      prizePool: "0",
    });
    await enterSolos(t.entryMatchId!, "FREE_FIRE", 12);
    await runMatchStatusJob(new Date(t.startsAt.getTime() - 29 * 60_000));
    const entry = await testDb().match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    expect(entry.status).toBe("REGISTRATION_CLOSED");
    const [m1, ...rest] = await testDb().match.findMany({
      where: { tournamentId: t.id, isEntryList: false },
      include: { registrations: true },
    });
    expect(rest).toHaveLength(0);
    expect(m1).toMatchObject({
      title: "FF Auto Cup — Match 1",
      lobbyNumber: 1,
      status: "REGISTRATION_CLOSED",
      startsAt: t.startsAt,
    });
    expect(m1!.registrations).toHaveLength(12);
    // A later run doesn't split again or cancel the match for having no registrations of its own.
    await runMatchStatusJob(new Date(t.startsAt.getTime() - 20 * 60_000));
    expect(await testDb().match.count({ where: { tournamentId: t.id, isEntryList: false } })).toBe(
      1,
    );
    expect(await testDb().notification.count({ where: { type: "TOURNAMENT_LOBBY" } })).toBe(12);
  });

  it("Valorant Deathmatch: lobbies of 10; players who fit no lobby are removed and told", async () => {
    const t = await createTournament(admin, {
      game: "VALORANT",
      mode: "SOLO",
      title: "Val Deathmatch",
      startsAt: inDays(1),
      prizePool: "0",
    });
    const players = await enterSolos(t.entryMatchId!, "VALORANT", 12);
    await lockEntries(admin, { tournamentId: t.id });
    const [lobby] = await testDb().match.findMany({
      where: { tournamentId: t.id, isEntryList: false },
      include: { registrations: true },
    });
    expect(lobby!.registrations).toHaveLength(10);
    const out = players.slice(10).map((p) => p.id);
    expect(
      await testDb().registration.count({
        where: { matchId: t.entryMatchId!, userId: { in: out }, status: "CANCELLED" },
      }),
    ).toBe(2);
    expect(
      await testDb().notification.count({
        where: { type: "TOURNAMENT_UNPLACED", userId: { in: out } },
      }),
    ).toBe(2);
  });

  it("sends the sign-up confirmation with the dashboard line (no lobby number)", async () => {
    const t = await createTournament(admin, {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "FF Mail Cup",
      startsAt: inDays(1),
      prizePool: "0",
    });
    const p = await createPlayer("FREE_FIRE");
    await registerForMatch({ id: p.id, role: "PLAYER" }, { matchId: t.entryMatchId! });
    const note = await testDb().notification.findFirstOrThrow({
      where: { userId: p.id, type: "REGISTRATION_CONFIRMED" },
    });
    expect(note.body).toContain(
      "After registration closes, check your lobby number on the dashboard.",
    );
    expect(note.url).toBe("/dashboard");
  });
});

describe("BGMI lobby-points tournament", () => {
  it("3 linked matches produce correct cumulative standings", async () => {
    const t = await createTournament(admin, {
      game: "BGMI",
      mode: "SQUAD",
      title: "BGMI Weekly",
      startsAt: inDays(1),
      prizePool: "3000",
    });
    const alpha = await enterTeam(t.entryMatchId!, "BGMI", "Alpha", 1);
    const bravo = await enterTeam(t.entryMatchId!, "BGMI", "Bravo", 2);
    const charlie = await enterTeam(t.entryMatchId!, "BGMI", "Charlie", 3);
    const matches = await addLobbyMatches(admin, {
      tournamentId: t.id,
      count: 3,
      firstStartsAt: inDays(1),
      gapMinutes: 45,
    });
    expect(matches.map((m) => m.title)).toEqual([
      "BGMI Weekly — Match 1",
      "BGMI Weekly — Match 2",
      "BGMI Weekly — Match 3",
    ]);

    expect(await lockEntries(admin, { tournamentId: t.id })).toEqual({
      teams: 3,
      matches: 3,
      lobbies: 3,
    });
    for (const m of matches) {
      const row = await testDb().match.findUniqueOrThrow({
        where: { id: m.id },
        include: { registrations: true, rosterEntries: true },
      });
      expect(row.status).toBe("REGISTRATION_CLOSED");
      expect(row.title).toBe(m.title); // one lobby: no "— Lobby 1" suffix
      expect(row.registrations.filter((r) => r.status === "CONFIRMED")).toHaveLength(3);
      expect(row.rosterEntries).toHaveLength(12);
    }

    // Placements [Alpha, Bravo, Charlie] per match, kills in brackets.
    const plan: [number, number][][] = [
      [
        [1, 8],
        [2, 3],
        [3, 1],
      ],
      [
        [3, 2],
        [1, 10],
        [2, 0],
      ],
      [
        [2, 5],
        [3, 1],
        [1, 4],
      ],
    ];
    const teams = [alpha, bravo, charlie];
    for (const [mi, m] of matches.entries()) {
      await toResultsPending(m.id);
      const regs = await testDb().registration.findMany({ where: { matchId: m.id } });
      await saveResultRows(mod, {
        matchId: m.id,
        rows: teams.map((team, ti) => ({
          registrationId: regs.find((r) => r.teamId === team.team.id)!.id,
          placement: plan[mi]![ti]![0],
          kills: plan[mi]![ti]![1],
        })),
      });
      await approveResults(mod, { matchId: m.id });
    }

    // Tournament multiplier ×2: (placement points + kills) × 2 per match.
    // Alpha: (15+8)+(10+2)+(12+5)=52 → 104; Bravo: (12+3)+(15+10)+(10+1)=51 → 102; Charlie: (10+1)+(12+0)+(15+4)=42 → 84
    const standings = await lobbyStandingsFor(testDb(), t.id);
    expect(standings.map((s) => [s.name, s.points, s.matches, s.wins, s.kills, s.rank])).toEqual([
      ["Alpha", 104, 3, 1, 15, 1],
      ["Bravo", 102, 3, 1, 14, 2],
      ["Charlie", 84, 3, 1, 5, 3],
    ]);

    // Every squad member also got season points (4 players × 3 teams × 3 matches).
    expect(await testDb().pointsEntry.count({ where: { match: { tournamentId: t.id } } })).toBe(36);

    // Publishing winners creates the home carousel card.
    await publishWinners(admin, { tournamentId: t.id, prizes: ["1500", "1000", "500"] });
    const saved = await testDb().tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(
      (saved.winners as { name: string; prizePaise: number }[]).map((w) => [w.name, w.prizePaise]),
    ).toEqual([
      ["Alpha", 150000],
      ["Bravo", 100000],
      ["Charlie", 50000],
    ]);
    const card = await testDb().carouselItem.findFirstOrThrow({ where: { tournamentId: t.id } });
    expect(card).toMatchObject({
      game: "BGMI",
      title: "Alpha won BGMI Weekly",
      subtitle: "2nd: Bravo · 3rd: Charlie",
      active: true,
    });
    // Republishing updates the same card.
    await publishWinners(admin, { tournamentId: t.id, prizes: ["2000", "1000", "500"] });
    expect(await testDb().carouselItem.count({ where: { tournamentId: t.id } })).toBe(1);
  });
});

describe("Valorant bracket with byes (DECISIONS M50)", () => {
  const valCup = () =>
    createTournament(admin, {
      game: "VALORANT",
      mode: "FIVE_V_FIVE",
      title: "Val Cup",
      startsAt: inDays(2),
      prizePool: "8000",
    });
  const sidesOf = async (matchId: string) =>
    (
      await testDb().registration.findMany({
        where: { matchId },
        orderBy: { position: "asc" },
        include: { team: true },
      })
    ).map((r) => ({ id: r.id, name: r.team!.name }));
  const namesOf = async (matchId: string) => (await sidesOf(matchId)).map((s) => s.name);
  const roundOf = async (tournamentId: string, round: number) =>
    testDb().match.findMany({
      where: { tournamentId, bracketRound: round },
      orderBy: { bracketIndex: "asc" },
    });

  /** Approve a bracket match with the lower seed number winning; round diff = loser's seed. */
  async function play(matchId: string) {
    await toResultsPending(matchId);
    const sides = await sidesOf(matchId);
    const seed = (s: { name: string }) => Number(s.name.slice(1));
    const winner = sides.reduce((a, b) => (seed(a) < seed(b) ? a : b));
    const loser = sides.find((s) => s.id !== winner.id)!;
    await saveResultRows(mod, {
      matchId,
      rows: sides.map((s) => ({
        registrationId: s.id,
        won: s.id === winner.id,
        roundDiff: s.id === winner.id ? seed(loser) : -seed(loser),
      })),
    });
    await approveResults(mod, { matchId });
  }

  it("8 teams pair in sign-up order and play to a champion", async () => {
    const t = await valCup();
    await enterTeam(t.entryMatchId!, "VALORANT", "S1", 1);
    await expect(
      generateBracket(admin, { tournamentId: t.id, firstRoundStartsAt: inDays(2) }),
    ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("at least 2") });
    for (let i = 2; i <= 8; i++) await enterTeam(t.entryMatchId!, "VALORANT", `S${i}`, i);
    const round1 = await generateBracket(admin, {
      tournamentId: t.id,
      firstRoundStartsAt: inDays(2),
    });
    await expect(
      generateBracket(admin, { tournamentId: t.id, firstRoundStartsAt: inDays(2) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await Promise.all(round1.map((m) => namesOf(m.id)))).toEqual([
      ["S1", "S2"],
      ["S3", "S4"],
      ["S5", "S6"],
      ["S7", "S8"],
    ]);
    expect(round1[0]!.title).toBe("Val Cup — Quarterfinals, game 1");

    for (const m of round1.slice(0, 3)) await play(m.id);
    expect(await roundOf(t.id, 2)).toHaveLength(0); // round 1 not finished yet
    await play(round1[3]!.id);
    const semis = await roundOf(t.id, 2);
    expect(await Promise.all(semis.map((m) => namesOf(m.id)))).toEqual([
      ["S1", "S3"],
      ["S5", "S7"],
    ]);
    expect(semis[0]!.status).toBe("REGISTRATION_CLOSED");

    await expect(
      publishWinners(admin, { tournamentId: t.id, prizes: ["4000", "2500", "1500"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    for (const m of semis) await play(m.id);
    const [final] = await roundOf(t.id, 3);
    expect(final!.title).toBe("Val Cup — Final");
    expect(await namesOf(final!.id)).toEqual(["S1", "S5"]);
    await play(final!.id);

    await publishWinners(admin, { tournamentId: t.id, prizes: ["4000", "2500", "1500"] });
    const saved = await testDb().tournament.findUniqueOrThrow({ where: { id: t.id } });
    // 3rd: the semifinal loser with the better round difference (S3 lost by 3, S7 by 7).
    expect((saved.winners as { name: string }[]).map((w) => w.name)).toEqual(["S1", "S5", "S3"]);
  });

  it("9 teams: the 9th gets a bye to round 2, which has 5 teams and gives another bye", async () => {
    const t = await valCup();
    for (let i = 1; i <= 9; i++) await enterTeam(t.entryMatchId!, "VALORANT", `S${i}`, i);
    // Registration closes 30 minutes before the start: the status job draws the bracket.
    await runMatchStatusJob(new Date(t.startsAt.getTime() - 29 * 60_000));
    const round1 = await roundOf(t.id, 1);
    expect(await Promise.all(round1.map((m) => namesOf(m.id)))).toEqual([
      ["S1", "S2"],
      ["S3", "S4"],
      ["S5", "S6"],
      ["S7", "S8"],
    ]);
    expect(round1[0]!.startsAt).toEqual(t.startsAt);
    const ready = await testDb().notification.findMany({ where: { type: "BRACKET_READY" } });
    expect(ready).toHaveLength(9 * 5); // every player, the team with the bye included

    for (const m of round1) await play(m.id);
    const round2 = await roundOf(t.id, 2);
    // S9 (bye) first, then the winners: S9 v S1, S3 v S5, S7 has the bye.
    expect(await Promise.all(round2.map((m) => namesOf(m.id)))).toEqual([
      ["S9", "S1"],
      ["S3", "S5"],
    ]);
    for (const m of round2) await play(m.id);
    const round3 = await roundOf(t.id, 3);
    expect(await Promise.all(round3.map((m) => namesOf(m.id)))).toEqual([["S7", "S1"]]);
    await play(round3[0]!.id);
    const [final] = await roundOf(t.id, 4);
    expect(final!.title).toBe("Val Cup — Final");
    expect(await namesOf(final!.id)).toEqual(["S3", "S1"]);
    await play(final!.id);

    await publishWinners(admin, { tournamentId: t.id, prizes: ["4000", "2500", "1500"] });
    const saved = await testDb().tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect((saved.winners as { name: string }[]).map((w) => w.name)).toEqual(["S1", "S3", "S7"]);
  });

  it("reopening a decided round removes the next round (until it starts)", async () => {
    const t = await valCup();
    for (let i = 1; i <= 8; i++) await enterTeam(t.entryMatchId!, "VALORANT", `S${i}`, i);
    const round1 = await generateBracket(admin, {
      tournamentId: t.id,
      firstRoundStartsAt: inDays(2),
    });
    for (const m of round1) await play(m.id);
    expect(await roundOf(t.id, 2)).toHaveLength(2);

    await reopenResults(mod, { matchId: round1[0]!.id, reason: "wrong winner" });
    expect(await roundOf(t.id, 2)).toHaveLength(0);
    await approveResults(mod, { matchId: round1[0]!.id });
    const again = await roundOf(t.id, 2);
    expect(await namesOf(again[0]!.id)).toEqual(["S1", "S3"]);

    // Once the next round has started, reopening is refused.
    await testDb().match.update({ where: { id: again[0]!.id }, data: { status: "LIVE" } });
    await expect(reopenResults(admin, { matchId: round1[0]!.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("already started"),
    });
  });

  it("a walkover (one side absent) advances the side that showed up", async () => {
    const t = await valCup();
    for (let i = 1; i <= 8; i++) await enterTeam(t.entryMatchId!, "VALORANT", `S${i}`, i);
    const round1 = await generateBracket(admin, {
      tournamentId: t.id,
      firstRoundStartsAt: inDays(2),
    });
    for (const m of round1.slice(0, 2)) {
      await toResultsPending(m.id);
      const regs = await testDb().registration.findMany({
        where: { matchId: m.id },
        orderBy: { position: "asc" },
      });
      await saveResultRows(mod, {
        matchId: m.id,
        rows: [
          { registrationId: regs[0]!.id, absent: true },
          { registrationId: regs[1]!.id, won: true },
        ],
      });
      await approveResults(mod, { matchId: m.id });
    }
    for (const m of round1.slice(2)) await play(m.id);
    const [semi] = await roundOf(t.id, 2);
    expect(await namesOf(semi!.id)).toEqual(["S2", "S4"]);
  });
});

describe("tournament entry fee", () => {
  const cup = (entryFee: string | undefined) =>
    createTournament(admin, {
      game: "VALORANT",
      mode: "FIVE_V_FIVE",
      title: "Paid Val Cup",
      startsAt: inDays(3),
      prizePool: "5000",
      ...(entryFee === undefined ? {} : { entryFee }),
    });
  const entryOf = async (t: { entryMatchId: string | null }) =>
    testDb().match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });

  it("is free by default, validated, and charged at sign-up (the sign-up list carries it)", async () => {
    expect((await entryOf(await cup(undefined))).entryFeePaise).toBe(0);
    await testDb().tournament.deleteMany();
    await expect(cup("-5")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(cup("abc")).rejects.toMatchObject({ code: "VALIDATION" });
    const t = await cup("99.50");
    expect((await entryOf(t)).entryFeePaise).toBe(9950);

    process.env.PAYMENTS_ENABLED = "true";
    try {
      const captain = await createPlayer("VALORANT");
      const mates = await Promise.all(Array.from({ length: 4 }, () => createPlayer("VALORANT")));
      const team = await testDb().team.create({
        data: {
          game: "VALORANT",
          name: "Paid Five",
          captainId: captain.id,
          members: {
            create: [captain, ...mates].map((p) => ({
              userId: p.id,
              game: "VALORANT" as const,
              status: "CONFIRMED" as const,
            })),
          },
        },
      });
      const { registerForMatch, respondToRoster } = await import("@/server/services/registration");
      const actor = (u: { id: string }): Actor => ({ id: u.id, role: "PLAYER" });
      await registerForMatch(actor(captain), {
        matchId: t.entryMatchId!,
        teamId: team.id,
        memberIds: mates.map((m) => m.id),
      });
      for (const m of mates)
        await respondToRoster(actor(m), { matchId: t.entryMatchId!, accept: true });
      const reg = await testDb().registration.findFirstOrThrow({
        where: { matchId: t.entryMatchId! },
      });
      expect(reg.status).toBe("PENDING_PAYMENT");
      expect(
        (await testDb().payment.findUniqueOrThrow({ where: { registrationId: reg.id } }))
          .amountPaise,
      ).toBe(9950);
    } finally {
      delete process.env.PAYMENTS_ENABLED;
    }
  });

  it("changes only while nobody has signed up", async () => {
    const t = await cup("50");
    const base = { tournamentId: t.id, title: t.title, prizePool: "5000", rulesMarkdown: "" };
    await updateTournament(admin, { ...base, entryFee: "75" });
    expect((await entryOf(t)).entryFeePaise).toBe(7500);
    const p = await createPlayer("VALORANT");
    await testDb().registration.create({
      data: { matchId: t.entryMatchId!, userId: p.id, status: "CONFIRMED", position: 1 },
    });
    await expect(updateTournament(admin, { ...base, entryFee: "10" })).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { entryFee: expect.any(Array) },
    });
    // Saving other details with the same fee is fine.
    await updateTournament(admin, { ...base, title: "Renamed Val Cup", entryFee: "75" });
    expect((await entryOf(t)).entryFeePaise).toBe(7500);
  });
});

describe("several tournaments per game, editing and cancelling", () => {
  const squadCup = () =>
    createTournament(admin, {
      game: "BGMI",
      mode: "SQUAD",
      title: "BGMI Squad Cup",
      startsAt: inDays(2, "20:00"),
      prizePool: "1000",
    });

  it("lists every current tournament for a game soonest first, without cancelled ones", async () => {
    const squad = await squadCup();
    const solo = await createTournament(admin, {
      game: "BGMI",
      mode: "SOLO",
      title: "BGMI Solo Cup",
      startsAt: inDays(2, "18:00"),
      prizePool: "0",
    });
    expect((await getCurrentTournaments("BGMI")).map((t) => t.id)).toEqual([solo.id, squad.id]);
    await cancelTournament(admin, { tournamentId: solo.id, reason: "Server outage" });
    expect((await getCurrentTournaments("BGMI")).map((t) => t.id)).toEqual([squad.id]);
    expect(await listPastTournaments("BGMI", addDays(new Date(), 30))).toHaveLength(1);
  });

  it("start and mode change only while nobody signed up; the sign-up list follows", async () => {
    const t = await squadCup();
    const base = { tournamentId: t.id, title: t.title, prizePool: "1000", rulesMarkdown: "" };
    await expect(updateTournament(admin, { ...base, mode: "FIVE_V_FIVE" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      updateTournament(admin, { ...base, startsAt: "not a date" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const after = await updateTournament(admin, {
      ...base,
      mode: "ONE_V_ONE",
      startsAt: inDays(3, "19:00"),
    });
    expect(after).toMatchObject({ mode: "ONE_V_ONE", format: "BRACKET", bracketSize: null });
    const entry = await testDb().match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    expect(entry).toMatchObject({ mode: "ONE_V_ONE", maxSlots: 2 });
    expect(entry.startsAt).toEqual(after.startsAt);
    expect(entry.registrationClosesAt!.getTime()).toBe(after.startsAt.getTime() - 30 * 60_000);

    const p = await createPlayer("BGMI");
    await testDb().registration.create({
      data: { matchId: entry.id, userId: p.id, status: "CONFIRMED", position: 1 },
    });
    await expect(updateTournament(admin, { ...base, mode: "SQUAD" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Details without structure changes still save.
    await expect(updateTournament(admin, { ...base, title: "Renamed Cup" })).resolves.toMatchObject(
      { title: "Renamed Cup" },
    );
  });

  it("cancelling validates the reason, cancels every open match (sign-up list included) and blocks further steps", async () => {
    const t = await squadCup();
    await enterTeam(t.entryMatchId!, "BGMI", "Alpha", 1);
    const lobbies = await addLobbyMatches(admin, {
      tournamentId: t.id,
      count: 2,
      firstStartsAt: inDays(2),
      gapMinutes: 45,
    });
    await expect(
      cancelTournament(admin, { tournamentId: t.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await toResultsPending(lobbies[0]!.id);
    await expect(
      cancelTournament(admin, { tournamentId: t.id, reason: "Server outage" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await testDb().match.update({ where: { id: lobbies[0]!.id }, data: { status: "UPCOMING" } });

    const r = await cancelTournament(admin, { tournamentId: t.id, reason: "Server outage" });
    expect(r.cancelledMatches).toBe(3);
    const saved = await testDb().tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(saved.cancelReason).toBe("Server outage");
    expect(saved.cancelledAt).not.toBeNull();
    const statuses = await testDb().match.findMany({
      where: { tournamentId: t.id },
      select: { status: true },
    });
    expect(statuses.every((m) => m.status === "CANCELLED")).toBe(true);
    expect(
      await testDb().registration.count({
        where: { matchId: t.entryMatchId!, status: { not: "CANCELLED" } },
      }),
    ).toBe(0);
    expect(
      await testDb().auditLog.count({ where: { entityId: t.id, action: "tournament.cancel" } }),
    ).toBe(1);
    await expect(lockEntries(admin, { tournamentId: t.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
