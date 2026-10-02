import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { catchUpMatchStatuses } from "@/server/jobs/status-catch-up";
import { gameFromSlug } from "@/lib/games";
import { MATCH_KINDS } from "@/lib/match-schema";
import { MATCH_STATUSES } from "@/lib/match-state";
import { assertModerator, type Actor } from "@/lib/roles";
import { istInputToUtc } from "@/lib/time";

export interface AdminMatchFilters {
  game?: string;
  kind?: string;
  status?: string;
  /** IST dates "YYYY-MM-DD" */
  from?: string;
  to?: string;
}

export function adminMatchWhere(f: AdminMatchFilters): Prisma.MatchWhereInput {
  const where: Prisma.MatchWhereInput = {};
  const game = gameFromSlug(f.game);
  if (game) where.game = game;
  if (f.kind && (MATCH_KINDS as readonly string[]).includes(f.kind))
    where.kind = f.kind as (typeof MATCH_KINDS)[number];
  if (f.status && (MATCH_STATUSES as readonly string[]).includes(f.status)) {
    where.status = f.status as (typeof MATCH_STATUSES)[number];
  }
  const from = f.from ? istInputToUtc(`${f.from}T00:00`) : null;
  const to = f.to ? istInputToUtc(`${f.to}T23:59`) : null;
  if (from || to) where.startsAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  return where;
}

export async function listMatchesForAdmin(actor: Actor | null, f: AdminMatchFilters) {
  assertModerator(actor);
  await catchUpMatchStatuses();
  return db.match.findMany({
    where: adminMatchWhere(f),
    orderBy: { startsAt: "asc" },
    take: 200,
    select: {
      id: true,
      game: true,
      kind: true,
      mode: true,
      title: true,
      startsAt: true,
      status: true,
      maxSlots: true,
      entryFeePaise: true,
      prizePaise: true,
      _count: { select: { registrations: { where: { status: "CONFIRMED" } } } },
    },
  });
}

export async function getMatchForAdmin(actor: Actor | null, id: string) {
  assertModerator(actor);
  await catchUpMatchStatuses();
  const match = await db.match.findUnique({
    where: { id },
    include: {
      tournament: { select: { id: true, title: true } },
      createdBy: { select: { displayName: true } },
      registrations: {
        orderBy: [{ status: "asc" }, { position: "asc" }],
        include: {
          user: { select: { id: true, displayName: true, phone: true } },
          team: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!match) throw new AppError("NOT_FOUND", "Match not found.");
  return match;
}

/**
 * Tournaments a manual match may join: lobby-points tournaments that are not cancelled,
 * plus the one the edited match is already linked to.
 */
export function listTournamentOptions(currentId?: string | null) {
  return db.tournament.findMany({
    where: {
      OR: [
        { format: "LOBBY_POINTS", cancelledAt: null },
        ...(currentId ? [{ id: currentId }] : []),
      ],
    },
    select: { id: true, title: true, game: true, mode: true, weekOf: true },
    orderBy: { weekOf: "desc" },
    take: 30,
  });
}
