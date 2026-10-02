import { AppError } from "@/server/errors";

export type Role = "PLAYER" | "MODERATOR" | "ADMIN";

/** The authenticated user performing an action. Services receive this explicitly. */
export interface Actor {
  id: string;
  role: Role;
}

const RANK: Record<Role, number> = { PLAYER: 0, MODERATOR: 1, ADMIN: 2 };

export function hasRole(actor: Pick<Actor, "role"> | null | undefined, min: Role): boolean {
  return !!actor && RANK[actor.role] >= RANK[min];
}

export function isStaff(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return hasRole(actor, "MODERATOR");
}

/** Throws UNAUTHENTICATED when there is no actor. */
export function assertUser(actor: Actor | null | undefined): Actor {
  if (!actor) throw new AppError("UNAUTHENTICATED", "Please log in to continue.");
  return actor;
}

/** MODERATOR or ADMIN. */
export function assertModerator(actor: Actor | null | undefined): Actor {
  const a = assertUser(actor);
  if (!hasRole(a, "MODERATOR")) throw new AppError("FORBIDDEN", "Moderators only.");
  return a;
}

export function assertAdmin(actor: Actor | null | undefined): Actor {
  const a = assertUser(actor);
  if (!hasRole(a, "ADMIN")) throw new AppError("FORBIDDEN", "Admins only.");
  return a;
}
