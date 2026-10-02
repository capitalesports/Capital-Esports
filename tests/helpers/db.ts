import { getDb } from "@/server/db";
import type { Game, MatchMode, MatchStatus, Role } from "@/generated/prisma/client";
import { addMinutes } from "@/lib/time";

export const testDb = () => getDb();

/** Truncate every application table (never drops schema; no `migrate reset` needed). */
export async function resetDb(): Promise<void> {
  const db = getDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let phoneSeq = 0;
export function nextPhone(): string {
  phoneSeq += 1;
  return `+9190000${String(10000 + phoneSeq).slice(-5)}`;
}

export async function createUser(
  opts: {
    role?: Role;
    phone?: string;
    displayName?: string | null;
    dateOfBirth?: Date | null;
    /** Verified email (required to register). Default: a unique one; null = none. */
    email?: string | null;
    games?: { game: Game; gameId: string; ign?: string; region?: string }[];
  } = {},
) {
  const db = getDb();
  const phone = opts.phone ?? nextPhone();
  const email = opts.email === undefined ? `p${phone.replace(/\D/g, "")}@test.in` : opts.email;
  return db.user.create({
    data: {
      phone,
      email,
      emailVerifiedAt: email ? new Date() : null,
      role: opts.role ?? "PLAYER",
      displayName: opts.displayName === undefined ? "Player" : opts.displayName,
      dateOfBirth: opts.dateOfBirth === undefined ? new Date("2000-01-01T00:00:00Z") : opts.dateOfBirth,
      gameProfiles: opts.games ? { create: opts.games } : undefined,
    },
    include: { gameProfiles: true },
  });
}

let gameIdSeq = 100000;
export function nextGameId(): string {
  gameIdSeq += 1;
  return String(gameIdSeq);
}

/** A complete player with a profile for `game`. */
export async function createPlayer(game: Game = "FREE_FIRE", extra: Parameters<typeof createUser>[0] = {}) {
  const gameId = game === "VALORANT" ? `player${nextGameId()}#tag1` : nextGameId();
  return createUser({
    ...extra,
    games: [{ game, gameId, ign: game === "VALORANT" ? gameId : "Exact Ign", region: game === "VALORANT" ? "AP" : undefined }],
  });
}

export async function createMatch(
  createdById: string,
  opts: {
    game?: Game;
    mode?: MatchMode;
    status?: MatchStatus;
    startsAt?: Date;
    maxSlots?: number;
    entryFeePaise?: number;
    title?: string;
    registrationOpensAt?: Date | null;
    kind?: "SCRIM" | "TOURNAMENT";
    tournamentId?: string;
    /**
     * Keep a fixed capacity (waitlist when full). Standalone scrims take unlimited entries and split
     * into lobbies, so this links the match to a throwaway tournament, whose matches keep maxSlots.
     */
    capped?: boolean;
  } = {},
) {
  const startsAt = opts.startsAt ?? addMinutes(new Date(), 180);
  const tournamentId = opts.capped
    ? await cappedTournamentId(opts.game ?? "FREE_FIRE", opts.mode ?? "SOLO")
    : opts.tournamentId;
  return getDb().match.create({
    data: {
      game: opts.game ?? "FREE_FIRE",
      kind: opts.kind ?? (opts.capped ? "TOURNAMENT" : "SCRIM"),
      mode: opts.mode ?? "SOLO",
      title: opts.title ?? "Test match",
      startsAt,
      registrationOpensAt: opts.registrationOpensAt ?? null,
      registrationClosesAt: addMinutes(startsAt, -30),
      maxSlots: opts.maxSlots ?? 10,
      entryFeePaise: opts.entryFeePaise ?? 0,
      status: opts.status ?? "REGISTRATION_OPEN",
      createdById,
      tournamentId,
    },
  });
}

let cappedSeq = 0;
/** A tournament in its own week (one per game, mode and week), just to cap a test match. */
async function cappedTournamentId(game: Game, mode: MatchMode): Promise<string> {
  cappedSeq += 1;
  const t = await getDb().tournament.create({
    data: {
      game,
      mode,
      format: "LOBBY_POINTS",
      title: "Capacity test",
      weekOf: new Date(Date.UTC(2000, 0, 3 + cappedSeq * 7)),
      startsAt: new Date(),
    },
  });
  return t.id;
}
