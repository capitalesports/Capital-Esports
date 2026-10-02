import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { isAccountBanned } from "@/lib/bans";
import { GAME_CONFIG, GAMES, type Game } from "@/lib/games";
import { isGameProfileComplete } from "@/lib/profile";
import { maxTeamMembers } from "@/lib/registration-rules";
import { assertUser, type Actor } from "@/lib/roles";
import { normalizeTeamCode, randomTeamCode, TEAM_CODE_LENGTH } from "@/lib/team-code";
import { canonicalGameId } from "@/lib/validators";
import { moveUpcomingRegistrations, removeFromUpcomingRosters } from "./admin-teams";
import { notify } from "./notify";

export const teamNameSchema = z
  .string()
  .trim()
  .min(2, "Team name must be at least 2 characters")
  .max(24, "Team name must be at most 24 characters")
  .regex(/^[\p{L}\p{N} ._-]+$/u, "Use letters, numbers, spaces and . _ - only");

async function confirmedTeamFor(tx: Tx, userId: string, game: Game) {
  return tx.teamMember.findFirst({
    where: { userId, game, status: "CONFIRMED" },
    include: { team: true },
  });
}

async function loadCaptainTeam(tx: Tx, teamId: string, captainId: string) {
  const team = await tx.team.findUnique({ where: { id: teamId } });
  if (!team) throw new AppError("NOT_FOUND", "Team not found.");
  if (team.captainId !== captainId)
    throw new AppError("FORBIDDEN", "Only the captain can do that.");
  return team;
}

export async function createTeam(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { game, name } = parseInput(z.object({ game: z.enum(GAMES), name: teamNameSchema }), input);
  try {
    return await db.$transaction(async (tx) => {
      const profile = await tx.gameProfile.findUnique({
        where: { userId_game: { userId: me.id, game } },
      });
      if (!profile)
        throw new AppError(
          "PROFILE_INCOMPLETE",
          `Add your ${GAME_CONFIG[game].idLabel} before creating a team.`,
          { missing: [GAME_CONFIG[game].idLabel] },
        );
      if (await confirmedTeamFor(tx, me.id, game)) {
        throw new AppError(
          "CONFLICT",
          `You are already in a ${GAME_CONFIG[game].name} team. Leave it first.`,
        );
      }
      return tx.team.create({
        data: {
          game,
          name,
          joinCode: await freshJoinCode(tx),
          captainId: me.id,
          members: {
            create: { userId: me.id, game, status: "CONFIRMED", confirmedAt: new Date() },
          },
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", "That team name is taken for this game.", {
        name: ["That team name is taken"],
      });
    }
    throw e;
  }
}

/** A join code no other team has (DECISIONS M17). */
async function freshJoinCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomTeamCode(randomInt);
    if (!(await tx.team.findUnique({ where: { joinCode: code }, select: { id: true } }))) return code;
  }
  throw new AppError("CONFLICT", "Could not create a team code. Please try again.");
}

export const JOIN_CODE_LIMIT = { limit: 20, windowSeconds: 600 };

const codeSchema = z.object({
  code: z
    .string()
    .max(20)
    .transform((s, ctx) => {
      const code = normalizeTeamCode(s);
      if (!code) {
        ctx.addIssue({ code: "custom", message: `Team codes are ${TEAM_CODE_LENGTH} letters` });
        return z.NEVER;
      }
      return code;
    }),
});

async function teamByCode(tx: Tx, code: string) {
  const team = await tx.team.findUnique({
    where: { joinCode: code },
    include: {
      captain: { select: { displayName: true } },
      _count: { select: { members: true } },
    },
  });
  if (!team) {
    throw new AppError("NOT_FOUND", "No team has that code.", { code: ["No team has that code"] });
  }
  return team;
}

/** Look up a team by its join code before joining (shows which game's ID the player needs). */
export async function findTeamByCode(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { code } = parseInput(codeSchema, input);
  // Codes are short: limit guessing.
  await enforceRateLimit(
    `team-code:${me.id}`,
    JOIN_CODE_LIMIT.limit,
    JOIN_CODE_LIMIT.windowSeconds,
    "Too many team code attempts. Please wait a few minutes.",
  );
  const team = await teamByCode(db, code);
  return {
    code: team.joinCode,
    name: team.name,
    game: team.game,
    captain: team.captain.displayName ?? "Captain",
    members: team._count.members,
  };
}

/**
 * Join a team with its code: the player needs a complete ID for the team's game (added on the join
 * form), must not be in another team for that game, and the team must have room. A pending invite
 * to the same team is accepted.
 */
export async function joinTeamByCode(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { code } = parseInput(codeSchema, input);
  await enforceRateLimit(
    `team-code:${me.id}`,
    JOIN_CODE_LIMIT.limit,
    JOIN_CODE_LIMIT.windowSeconds,
    "Too many team code attempts. Please wait a few minutes.",
  );
  const joined = await db.$transaction(async (tx) => {
    const team = await teamByCode(tx, code);
    const cfg = GAME_CONFIG[team.game];
    const user = await tx.user.findUniqueOrThrow({ where: { id: me.id } });
    if (isAccountBanned(user)) throw new AppError("FORBIDDEN", "Your account is banned.");
    const profile = await tx.gameProfile.findUnique({
      where: { userId_game: { userId: me.id, game: team.game } },
    });
    if (!profile || !isGameProfileComplete(profile)) {
      throw new AppError("PROFILE_INCOMPLETE", `Add your ${cfg.idLabel} to join this team.`, {
        missing: [cfg.idLabel],
      });
    }
    // A player in a team (any game) doesn't join another one by code (DECISIONS M19).
    const current = await tx.teamMember.findFirst({
      where: { userId: me.id, status: "CONFIRMED" },
      include: { team: { select: { name: true } } },
    });
    if (current) {
      throw new AppError(
        "CONFLICT",
        current.teamId === team.id
          ? "You are already in this team."
          : `You are already in ${current.team.name}. Leave it before joining another team.`,
      );
    }
    const invite = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: me.id } },
    });
    if (invite) {
      await tx.teamMember.update({
        where: { id: invite.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      return team;
    }
    const max = maxTeamMembers(cfg.teamSize);
    if (team._count.members >= max) {
      throw new AppError("CONFLICT", `This team is full (${max} players including invites).`);
    }
    await tx.teamMember.create({
      data: {
        teamId: team.id,
        userId: me.id,
        game: team.game,
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });
    return team;
  });
  return { teamId: joined.id, name: joined.name };
}

/** Captain invites a player by their in-game ID (must belong to an existing profile). */
export async function inviteToTeam(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { teamId, gameId } = parseInput(
    z.object({ teamId: z.string().min(1), gameId: z.string().trim().min(3).max(40) }),
    input,
  );
  const invitedUserId = await db.$transaction(async (tx) => {
    const team = await loadCaptainTeam(tx, teamId, me.id);
    const profile = await tx.gameProfile.findUnique({
      where: { game_gameId: { game: team.game, gameId: canonicalGameId(team.game, gameId) } },
      include: { user: true },
    });
    const label = GAME_CONFIG[team.game].idLabel;
    if (!profile || profile.user.deletedAt) {
      throw new AppError("NOT_FOUND", `No player has linked that ${label}.`, {
        gameId: [`No player has linked that ${label}`],
      });
    }
    if (isAccountBanned(profile.user)) throw new AppError("FORBIDDEN", "That player is banned.");
    if (profile.userId === me.id) throw new AppError("VALIDATION", "You are already in the team.");
    const existing = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: profile.userId } },
    });
    if (existing)
      throw new AppError(
        "CONFLICT",
        existing.status === "CONFIRMED"
          ? "That player is already in the team."
          : "That player is already invited.",
      );
    const count = await tx.teamMember.count({ where: { teamId } });
    const max = maxTeamMembers(GAME_CONFIG[team.game].teamSize);
    if (count >= max)
      throw new AppError("CONFLICT", `Teams can have at most ${max} members (including invites).`);
    await tx.teamMember.create({
      data: { teamId, userId: profile.userId, game: team.game, status: "INVITED" },
    });
    return profile.userId;
  });
  await notify({ type: "TEAM_INVITE", userIds: [invitedUserId], teamId });
}

export async function respondToTeamInvite(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { teamId, accept } = parseInput(
    z.object({ teamId: z.string().min(1), accept: z.boolean() }),
    input,
  );
  await db.$transaction(async (tx) => {
    const invite = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: me.id } },
    });
    if (!invite || invite.status !== "INVITED")
      throw new AppError("NOT_FOUND", "No pending invite for this team.");
    if (!accept) {
      await tx.teamMember.delete({ where: { id: invite.id } });
      return;
    }
    const current = await confirmedTeamFor(tx, me.id, invite.game);
    if (current) {
      throw new AppError(
        "CONFLICT",
        `You are already in ${current.team.name}. Leave it before joining another ${GAME_CONFIG[invite.game].name} team.`,
      );
    }
    const profile = await tx.gameProfile.findUnique({
      where: { userId_game: { userId: me.id, game: invite.game } },
    });
    if (!profile)
      throw new AppError(
        "PROFILE_INCOMPLETE",
        `Add your ${GAME_CONFIG[invite.game].idLabel} first.`,
      );
    await tx.teamMember.update({
      where: { id: invite.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  });
}

/** Leave a team. A captain with teammates must hand over captaincy first; a lone captain deletes the team. */
export async function leaveTeam(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { teamId } = parseInput(z.object({ teamId: z.string().min(1) }), input);
  await db.$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId }, include: { members: true } });
    const member = team?.members.find((m) => m.userId === me.id);
    if (!team || !member) throw new AppError("NOT_FOUND", "You are not in this team.");
    if (team.captainId === me.id) {
      const others = team.members.filter((m) => m.userId !== me.id && m.status === "CONFIRMED");
      if (others.length)
        throw new AppError("CONFLICT", "Make someone else captain before leaving.");
      await tx.team.delete({ where: { id: teamId } });
      return;
    }
    await tx.teamMember.delete({ where: { id: member.id } });
    await removeFromUpcomingRosters(tx, teamId, me.id);
  });
}

const memberSchema = z.object({ teamId: z.string().min(1), userId: z.string().min(1) });

export async function removeTeamMember(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { teamId, userId } = parseInput(memberSchema, input);
  if (userId === me.id) throw new AppError("VALIDATION", "Use “Leave team” to leave.");
  await db.$transaction(async (tx) => {
    await loadCaptainTeam(tx, teamId, me.id);
    const { count } = await tx.teamMember.deleteMany({ where: { teamId, userId } });
    if (!count) throw new AppError("NOT_FOUND", "That player is not in the team.");
    await removeFromUpcomingRosters(tx, teamId, userId);
  });
}

export async function transferCaptaincy(actor: Actor | null, input: unknown) {
  const me = assertUser(actor);
  const { teamId, userId } = parseInput(memberSchema, input);
  await db.$transaction(async (tx) => {
    await loadCaptainTeam(tx, teamId, me.id);
    const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!member || member.status !== "CONFIRMED")
      throw new AppError("VALIDATION", "The new captain must be a confirmed member.");
    await tx.team.update({ where: { id: teamId }, data: { captainId: userId } });
    // The new captain submits results and pays for the team's upcoming entries.
    await moveUpcomingRegistrations(tx, teamId, me.id, userId);
  });
}

/** Teams and invites for the teams page / dashboard. */
export async function getMyTeams(userId: string) {
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          captain: { select: { id: true, displayName: true } },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  gameProfiles: { select: { game: true, gameId: true, ign: true } },
                },
              },
            },
            orderBy: { invitedAt: "asc" },
          },
        },
      },
    },
    orderBy: { invitedAt: "asc" },
  });
  return {
    teams: memberships.filter((m) => m.status === "CONFIRMED").map((m) => m.team),
    invites: memberships.filter((m) => m.status === "INVITED").map((m) => m.team),
  };
}
