import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getResultReader } from "@/server/providers/result-reader";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { GAME_CONFIG } from "@/lib/games";
import { checkImage, SCREENSHOT_MAX_BYTES } from "@/lib/image";
import { isHeadToHead } from "@/lib/match-modes";
import { matchReadRows, type EntryNames, type MatchOutcome } from "@/lib/result-matching";
import { assertModerator, type Actor } from "@/lib/roles";

/** Screenshots per read, and reads per staff member per hour (protects the free API quota). */
export const SCREENSHOTS_PER_READ = 4;
export const SCREENSHOT_READ_LIMIT = { limit: 30, windowSeconds: 3600 };

/** Every name an entry may appear under on a result screen. */
async function entryNames(matchId: string, game: keyof typeof GAME_CONFIG): Promise<EntryNames[]> {
  const regs = await db.registration.findMany({
    where: { matchId, status: { in: ["CONFIRMED", "NO_SHOW"] } },
    orderBy: { position: "asc" },
    select: {
      id: true,
      team: { select: { name: true } },
      user: {
        select: {
          displayName: true,
          gameProfiles: { where: { game }, select: { ign: true, gameId: true } },
        },
      },
      members: { select: { ign: true, gameId: true, user: { select: { displayName: true } } } },
    },
  });
  return regs.map((r) => ({
    registrationId: r.id,
    names: [
      r.team?.name,
      r.user.displayName,
      ...r.user.gameProfiles.flatMap((p) => [p.ign, p.gameId]),
      ...r.members.flatMap((m) => [m.ign, m.gameId, m.user?.displayName]),
    ].filter((n): n is string => !!n && n.trim().length > 0),
  }));
}

/**
 * Staff upload the end-of-match screenshots; the reader (Gemini) returns rows and we match them to
 * the match's entries. Nothing is saved: the results editor fills its form with the suggestions,
 * and the admin checks, edits and approves as usual (DECISIONS M48).
 */
export async function readResultScreenshots(
  actor: Actor | null,
  input: unknown,
  images: Uint8Array[],
): Promise<MatchOutcome & { rowsRead: number }> {
  const me = assertModerator(actor);
  const { matchId } = parseInput(z.object({ matchId: z.string().min(1).max(50) }), input);
  if (images.length === 0) throw new AppError("VALIDATION", "Choose at least one screenshot.");
  if (images.length > SCREENSHOTS_PER_READ) {
    throw new AppError(
      "VALIDATION",
      `Upload at most ${SCREENSHOTS_PER_READ} screenshots at a time.`,
    );
  }
  const checked = images.map((bytes) => {
    const c = checkImage(bytes, SCREENSHOT_MAX_BYTES);
    if (!c.ok) throw new AppError("VALIDATION", c.error);
    return { mime: c.mime, bytes };
  });
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: { game: true, mode: true, status: true },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  if (match.status !== "RESULTS_PENDING") {
    throw new AppError("CONFLICT", "Screenshots can be read while results are pending.");
  }
  const reader = getResultReader();
  if (!reader) {
    throw new AppError(
      "UNAVAILABLE",
      "Screenshot reading isn't set up yet (no Gemini API key). Fill the results by hand.",
    );
  }
  await enforceRateLimit(
    `result-read:${me.id}`,
    SCREENSHOT_READ_LIMIT.limit,
    SCREENSHOT_READ_LIMIT.windowSeconds,
    "Too many screenshot reads this hour. Fill the results by hand or try again later.",
  );

  const entries = await entryNames(matchId, match.game);
  let rows;
  try {
    rows = await reader.read(checked, {
      game: GAME_CONFIG[match.game].name,
      mode: match.mode,
      headToHead: isHeadToHead(match.mode),
      knownNames: entries.flatMap((e) => e.names),
    });
  } catch (e) {
    const quota = e instanceof Error && e.message === "QUOTA";
    throw new AppError(
      "UNAVAILABLE",
      quota
        ? "Today's free screenshot reading limit is used up. Fill the results by hand."
        : "Couldn't read the screenshots right now. Try again, or fill the results by hand.",
    );
  }
  return { ...matchReadRows(entries, rows), rowsRead: rows.length };
}
