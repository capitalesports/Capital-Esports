/**
 * LOCAL DEMO ONLY (DECISIONS M60): a Valorant 2v2 tournament with 230 registered teams (460 dummy
 * players, random order), registration closed and round 1 of the bracket drawn, to try the
 * admin "Team codes" panel. Refuses to run against anything but localhost.
 *
 *   npx tsx --conditions=react-server scripts/demo-h2h-codes.ts          # create
 *   npx tsx --conditions=react-server scripts/demo-h2h-codes.ts --remove # delete the demo again
 *
 * Dummy players use phones +9190000xxxxx and emails demo-h2h-xxxx@example.in.
 */
import "dotenv/config";
import { db } from "@/server/db";
import { createTournament, generateBracket } from "@/server/services/tournaments";
import { deleteTournament } from "@/server/services/tournament-delete";
import { addDays, utcToIstInput } from "@/lib/time";

const TEAMS = 230;
const TITLE = "Demo Valorant 2v2 Scrims";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Refusing: DATABASE_URL is not a local database.");
}

const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", deletedAt: null } });
const actor = { id: admin.id, role: "ADMIN" as const };

async function remove() {
  for (const t of await db.tournament.findMany({ where: { title: TITLE } }))
    await deleteTournament(actor, { tournamentId: t.id });
  const { count } = await db.user.deleteMany({ where: { email: { startsWith: "demo-h2h-" } } });
  console.log(`Removed demo tournament(s) and ${count} dummy players.`);
}

await remove();
if (process.argv.includes("--remove")) process.exit(0);

const day = utcToIstInput(addDays(new Date(), 1)).slice(0, 10);
const t = await createTournament(actor, {
  game: "VALORANT",
  mode: "TWO_V_TWO",
  title: TITLE,
  startsAt: `${day}T20:00`,
  prizePool: "2000",
});

// Random sign-up order = random bracket.
const order = Array.from({ length: TEAMS }, (_, i) => i).sort(() => Math.random() - 0.5);
const pad = (n: number, w = 4) => String(n).padStart(w, "0");
for (const [position, i] of order.entries()) {
  const players = await Promise.all(
    [0, 1].map((k) => {
      const n = i * 2 + k + 1;
      return db.user.create({
        data: {
          phone: `+9190000${pad(n, 5)}`,
          email: `demo-h2h-${pad(n)}@example.in`,
          emailVerifiedAt: new Date(),
          displayName: `Demo ${pad(n)}`,
          dateOfBirth: new Date("2000-01-01T00:00:00Z"),
          gameProfiles: {
            create: {
              game: "VALORANT",
              gameId: `demo${pad(n)}#ind`,
              ign: `Demo${pad(n)}#IND`,
              region: "AP",
            },
          },
        },
      });
    }),
  );
  await db.registration.create({
    data: {
      matchId: t.entryMatchId!,
      userId: players[0]!.id,
      teamName: `Team ${pad(i + 1, 3)}`,
      status: "CONFIRMED",
      position: position + 1,
      members: {
        create: players.map((p, k) => ({
          matchId: t.entryMatchId!,
          userId: p.id,
          gameId: `demo${pad(i * 2 + k + 1)}#ind`,
          ign: `Demo${pad(i * 2 + k + 1)}#IND`,
          status: "CONFIRMED" as const,
          respondedAt: new Date(),
        })),
      },
    },
  });
}

const round1 = await generateBracket(actor, {
  tournamentId: t.id,
  firstRoundStartsAt: `${day}T20:00`,
});
console.log(`Created "${TITLE}": ${TEAMS} teams, round 1 has ${round1.length} matches.`);
console.log(`Admin: http://localhost:3100/admin/tournaments/${t.id}`);
await db.$disconnect();
process.exit(0);
