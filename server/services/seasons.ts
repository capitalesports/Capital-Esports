import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { GAME_CONFIG, GAMES, type Game } from "@/lib/games";
import { assertAdmin, type Actor } from "@/lib/roles";
import { istInputToUtc } from "@/lib/time";
import { refreshLeaderboard } from "./leaderboard";

/** Seasons last 3 calendar months. */
export function seasonEnd(startsAt: Date): Date {
  const end = new Date(startsAt);
  end.setUTCMonth(end.getUTCMonth() + 3);
  return end;
}

function nextSeasonName(previous: string): string {
  const m = /^(.*?)(\d+)$/.exec(previous.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${previous} 2`;
}

/**
 * Archive a season: final standings stay in LeaderboardSnapshot (browsable forever),
 * the top 3 are stored as champions, and the season becomes inactive.
 */
export async function archiveSeason(tx: Tx, seasonId: string) {
  await refreshLeaderboard(tx, seasonId);
  const top = await tx.leaderboardSnapshot.findMany({
    where: { seasonId },
    orderBy: [{ rank: "asc" }, { lastScoredAt: "asc" }],
    take: 3,
  });
  await tx.seasonResult.deleteMany({ where: { seasonId } });
  await tx.seasonResult.createMany({
    data: top.map((t, i) => ({ seasonId, userId: t.userId, rank: i + 1, points: t.points })),
  });
  await tx.season.update({ where: { id: seasonId }, data: { isActive: false } });
  return top.length;
}

/**
 * Season-end job: every active season whose end has passed is archived and the next 3-month
 * season starts where it ended. Strikes reset when a season rolls over ("3 strikes in a season").
 */
export async function runSeasonRollover(now = new Date()) {
  const due = await db.season.findMany({ where: { isActive: true, endsAt: { lte: now } } });
  const rolled: { game: Game; archivedId: string; nextId: string }[] = [];
  for (const season of due) {
    const next = await db.$transaction(async (tx) => {
      const current = await tx.season.findUnique({ where: { id: season.id } });
      if (!current?.isActive) return null; // another run got here first
      await archiveSeason(tx, season.id);
      const created = await tx.season.create({
        data: {
          game: season.game,
          name: nextSeasonName(season.name),
          startsAt: season.endsAt,
          endsAt: seasonEnd(season.endsAt),
          isActive: true,
        },
      });
      await writeAudit(tx, {
        actorId: null,
        action: "season.rollover",
        entityType: "Season",
        entityId: season.id,
        before: { isActive: true },
        after: { isActive: false, nextSeasonId: created.id },
      });
      return created;
    });
    if (next) rolled.push({ game: season.game, archivedId: season.id, nextId: next.id });
  }
  if (rolled.length) {
    await db.user.updateMany({ where: { strikes: { gt: 0 } }, data: { strikes: 0 } });
  }
  return rolled;
}

const endSchema = z.object({ seasonId: z.string().min(1) });

export async function endSeason(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { seasonId } = parseInput(endSchema, input);
  await db.$transaction(async (tx) => {
    const season = await tx.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new AppError("NOT_FOUND", "Season not found.");
    if (!season.isActive) throw new AppError("CONFLICT", "This season has already ended.");
    const champions = await archiveSeason(tx, seasonId);
    await writeAudit(tx, {
      actorId: me.id,
      action: "season.end",
      entityType: "Season",
      entityId: seasonId,
      before: { isActive: true },
      after: { isActive: false, champions },
    });
  });
}

const startSchema = z.object({
  game: z.enum(GAMES),
  name: z.string().trim().min(2).max(40),
  /** IST date "YYYY-MM-DD"; season starts at 00:00 IST */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
});

export async function startSeason(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { game, name, startsOn } = parseInput(startSchema, input);
  const startsAt = istInputToUtc(`${startsOn}T00:00`)!;
  return db.$transaction(async (tx) => {
    const active = await tx.season.findFirst({ where: { game, isActive: true } });
    if (active)
      throw new AppError("CONFLICT", `End the current ${GAME_CONFIG[game].name} season first.`);
    const season = await tx.season.create({
      data: { game, name, startsAt, endsAt: seasonEnd(startsAt), isActive: true },
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "season.start",
      entityType: "Season",
      entityId: season.id,
      after: season,
    });
    return season;
  });
}

/** One quoted CSV cell; spreadsheet formulas are neutralised. */
export function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportSeasonCsv(
  actor: Actor | null,
  seasonId: string,
): Promise<{ filename: string; csv: string }> {
  assertAdmin(actor);
  const season = await db.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new AppError("NOT_FOUND", "Season not found.");
  if (season.isActive) await db.$transaction((tx) => refreshLeaderboard(tx, seasonId));
  const rows = await db.leaderboardSnapshot.findMany({
    where: { seasonId },
    orderBy: { rank: "asc" },
    include: {
      user: {
        select: {
          displayName: true,
          gameProfiles: { where: { game: season.game }, select: { gameId: true, ign: true } },
        },
      },
    },
  });
  const header = ["rank", "player", "game_id", "points", "matches", "wins", "kills", "round_diff"];
  const lines = rows.map((r) => {
    const gp = r.user.gameProfiles[0];
    const gameId = season.game === "VALORANT" ? (gp?.ign ?? "") : (gp?.gameId ?? "");
    return [
      r.rank,
      r.user.displayName ?? "",
      gameId,
      r.points,
      r.matches,
      r.wins,
      r.kills,
      r.roundDiff,
    ]
      .map(csvCell)
      .join(",");
  });
  const slug = GAME_CONFIG[season.game].slug;
  return {
    filename: `leaderboard-${slug}-${season.name.replace(/\W+/g, "-").toLowerCase()}.csv`,
    csv: [header.join(","), ...lines].join("\n") + "\n",
  };
}
