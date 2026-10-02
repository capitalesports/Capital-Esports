import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { parseInput } from "@/server/validation";
import { GAMES, type Game } from "@/lib/games";
import type { PointsConfigValues } from "@/lib/points";
import { assertAdmin, type Actor } from "@/lib/roles";
import { pointsConfigFor } from "./leaderboard";

const points = (label: string, min = 0) =>
  z.coerce
    .number({ message: `${label}: enter a whole number` })
    .int(`${label}: enter a whole number`)
    .min(min, `${label}: at least ${min}`)
    .max(1000, `${label}: at most 1000`);

/** "15, 12, 10" -> [15, 12, 10]; index 0 = 1st place. Empty = no placement points. */
const placementList = z
  .string()
  .max(1000)
  .transform((raw, ctx) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 100) {
      ctx.addIssue({ code: "custom", message: "At most 100 placements" });
      return z.NEVER;
    }
    const values = parts.map(Number);
    if (values.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) {
      ctx.addIssue({
        code: "custom",
        message: "Whole numbers from 0 to 1000, separated by commas (1st place first)",
      });
      return z.NEVER;
    }
    return values;
  });

export const pointsConfigSchema = z.object({
  game: z.enum(GAMES),
  placementPoints: placementList,
  killPoints: points("Points per kill"),
  winPoints: points("Win points"),
  lossPoints: points("Loss points"),
  tournamentMultiplier: points("Tournament multiplier", 1).max(10, "At most 10"),
});

/** Current scoring for every game (stored row, or the built-in defaults). */
export async function listPointsConfigs(
  actor: Actor | null,
): Promise<{ game: Game; config: PointsConfigValues }[]> {
  assertAdmin(actor);
  return Promise.all(GAMES.map(async (game) => ({ game, config: await pointsConfigFor(db, game) })));
}

/** Save one game's scoring. Applies to results approved from now on (existing points stay). */
export async function savePointsConfig(actor: Actor | null, input: unknown) {
  const me = assertAdmin(actor);
  const { game, ...values } = parseInput(pointsConfigSchema, input);
  return db.$transaction(async (tx) => {
    const before = await pointsConfigFor(tx, game);
    const saved = await tx.pointsConfig.upsert({
      where: { game },
      create: { game, ...values },
      update: values,
    });
    await writeAudit(tx, {
      actorId: me.id,
      action: "points.config",
      entityType: "PointsConfig",
      entityId: game,
      before,
      after: values,
    });
    return saved;
  });
}
