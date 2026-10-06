import "server-only";
import type { RegistrationPanelState } from "@/components/match/registration-panel";
import type { SessionUser } from "@/server/auth/session";
import { paymentProvider, paymentsEnabled } from "@/server/env";
import { isTeamMode, playersPerSlot } from "@/lib/match-schema";
import { takesEveryone } from "@/lib/lobbies";
import {
  gameProfileFor,
  isGameProfileComplete,
  missingForRegistration,
  PROFILE_ITEMS,
} from "@/lib/profile";
import { BLOCK_MESSAGE, canCancelRegistration, registrationBlock } from "@/lib/registration-rules";
import { db } from "@/server/db";
import { getMyTeamsForGame, getViewerEntry, waitlistRank, type PublicMatch } from "./matches";

async function pendingPayment(registrationId: string, status: string) {
  if (status !== "PENDING_PAYMENT") return null;
  const p = await db.payment.findUnique({
    where: { registrationId },
    select: { amountPaise: true, expiresAt: true },
  });
  return p ? { amountPaise: p.amountPaise, expiresAt: p.expiresAt.toISOString() } : null;
}

/** Which checkout the client opens: Razorpay, Cashfree sandbox/production, or the local test checkout. */
export function checkoutMode(): "sandbox" | "production" | "razorpay" | "stub" {
  const provider = paymentProvider();
  if (provider === "razorpay") return "razorpay";
  if (provider === "stub") return "stub";
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

/** Work out what the registration box on a match page should show for this viewer. */
export async function buildPanelState(
  match: PublicMatch,
  user: SessionUser | null,
  returnTo: string,
  now = new Date(),
): Promise<RegistrationPanelState> {
  if (!user) return { kind: "ANON", loginHref: `/login?returnTo=${encodeURIComponent(returnTo)}` };

  const { registration, rosterSpot } = await getViewerEntry(match.id, user.id);
  const active = registration && registration.status !== "CANCELLED";
  if (active) {
    return {
      kind: "REGISTERED",
      status: registration.status as Exclude<typeof registration.status, "CANCELLED">,
      waitlistRank:
        registration.status === "WAITLISTED"
          ? await waitlistRank(match.id, registration.position)
          : null,
      canCancel: canCancelRegistration(match, now, registration.status !== "PENDING_PAYMENT"),
      teamName: registration.team?.name ?? registration.teamName ?? null,
      roster: registration.members.map((m) => ({
        name: m.ign ?? m.user?.displayName ?? "Player",
        // The registering captain is the team's IGL.
        igl: m.userId === registration.userId,
        status: m.status,
      })),
      payment: await pendingPayment(registration.id, registration.status),
    };
  }
  if (rosterSpot && rosterSpot.registration.status !== "CANCELLED") {
    const captainName = rosterSpot.registration.user.displayName ?? "Your captain";
    const teamName =
      rosterSpot.registration.team?.name ?? rosterSpot.registration.teamName ?? "their team";
    if (rosterSpot.status === "INVITED" && rosterSpot.registration.status === "PENDING") {
      return { kind: "ROSTER_INVITE", captainName, teamName };
    }
    return {
      kind: "ON_ROSTER",
      captainName,
      teamName,
      registrationStatus: rosterSpot.registration.status,
    };
  }

  // Name, date of birth and email live on the profile; the game ID (and exact in-game name) is
  // asked for right in the panel.
  const onProfile = missingForRegistration(user, match.game).filter((m) =>
    (PROFILE_ITEMS as readonly string[]).includes(m),
  );
  if (onProfile.length)
    return {
      kind: "INCOMPLETE",
      profileHref: `/profile?returnTo=${encodeURIComponent(returnTo)}`,
      missing: onProfile,
    };
  // Whether registration is possible at all comes first; the player's own game ID (missing or
  // incomplete) is filled in inside the registration pop-up (DECISIONS M14).
  const block = registrationBlock(user, match, now, paymentsEnabled());
  if (block) return { kind: "UNAVAILABLE", message: BLOCK_MESSAGE[block] };

  const profile = gameProfileFor(user, match.game);
  const playingAs = {
    game: match.game,
    value: profile ? { gameId: profile.gameId, ign: profile.ign, region: profile.region } : null,
    complete: !!profile && isGameProfileComplete(profile),
  };

  // Open-entry scrims never fill (more lobbies open at close); capped matches waitlist when full.
  const willWaitlist = !takesEveryone(match) && match._count.registrations >= match.maxSlots;
  if (!isTeamMode(match.mode)) return { kind: "SOLO", mode: match.mode, willWaitlist, playingAs };

  // A saved team can fill the roster in one tap (DECISIONS M17): teammates with a complete ID for
  // this game are ready; the rest are shown as missing. The registering player is the IGL.
  const teams = await getMyTeamsForGame(user.id, match.game);
  return {
    kind: "TEAM",
    mode: match.mode,
    size: playersPerSlot(match.game, match.mode),
    willWaitlist,
    playingAs,
    createTeamHref: "/teams",
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members
        .filter((m) => m.user.id !== user.id)
        .map((m) => {
          const p = m.user.gameProfiles[0];
          return {
            id: m.user.id,
            name: m.user.displayName ?? "Player",
            // The ID as the player types it (Valorant: the Riot ID as typed, kept in `ign`).
            gameId: p ? (match.game === "VALORANT" ? (p.ign ?? p.gameId) : p.gameId) : null,
            ign: p && match.game !== "VALORANT" ? p.ign : null,
            ready: !!p && isGameProfileComplete(p),
          };
        }),
    })),
  };
}
