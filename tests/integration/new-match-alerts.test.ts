import { beforeEach, describe, expect, it } from "vitest";
import { runMatchStatusJob } from "@/server/jobs/match-status-job";
import { runNewMatchAlerts } from "@/server/jobs/new-match-alerts";
import { createTournament } from "@/server/services/tournaments";
import type { Actor } from "@/lib/roles";
import { addDays, utcToIstInput } from "@/lib/time";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

/** New scrim / tournament alerts to every player (DECISIONS M64). */

let admin: Actor;
const inDays = (d: number, hhmm = "20:00") =>
  `${utcToIstInput(addDays(new Date(), d)).slice(0, 10)}T${hhmm}`;
const alerts = () =>
  testDb().notification.findMany({
    where: { type: "ANNOUNCEMENT" },
    orderBy: { createdAt: "asc" },
  });

beforeEach(async () => {
  await resetDb();
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
});

describe("new match alerts", () => {
  it("announces a tournament once, then tells everyone again when registration opens", async () => {
    const [a, b] = [await createPlayer(), await createPlayer()];
    const gone = await createPlayer();
    await testDb().user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const t = await createTournament(admin, {
      game: "BGMI",
      mode: "SQUAD",
      title: "Alert Cup",
      startsAt: inDays(3),
      prizePool: "1000",
      registrationOpensAt: inDays(1, "12:00"),
    });

    expect(await runNewMatchAlerts()).toEqual({ newMatchAlerts: 1 });
    let rows = await alerts();
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());
    expect(rows[0]).toMatchObject({ title: "New tournament: Alert Cup" });
    expect(rows[0]!.url).toBe(`/tournament/bgmi?t=${t.id}`);
    // Never twice.
    expect(await runNewMatchAlerts()).toEqual({ newMatchAlerts: 0 });

    const entry = await testDb().match.findUniqueOrThrow({ where: { id: t.entryMatchId! } });
    const opensAt = new Date(entry.registrationOpensAt!.getTime() + 60_000);
    await runMatchStatusJob(opensAt);
    expect(await runNewMatchAlerts(opensAt)).toEqual({ newMatchAlerts: 1 });
    rows = await alerts();
    expect(rows.filter((r) => r.title === "Registration open: Alert Cup")).toHaveLength(2);
  });

  it("scrims opening together go out as one alert; lobby and tournament games never do", async () => {
    await createPlayer();
    await createMatch(admin.id, { title: "Scrim One" });
    await createMatch(admin.id, { title: "Scrim Two" });
    await createMatch(admin.id, { title: "Tournament game", capped: true });
    expect(await runNewMatchAlerts()).toEqual({ newMatchAlerts: 1 });
    const [row] = await alerts();
    expect(row).toMatchObject({ title: "2 new scrims open", url: "/scrims" });
    expect(row!.body).toContain("Scrim One");
    expect(row!.body).not.toContain("Tournament game");
  });
});
