"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { IntentLink as Link } from "@/components/common/intent-link";
import { useRouter } from "next/navigation";
import {
  cancelRegistrationAction,
  registerAction,
  respondToRosterAction,
} from "@/app/(site)/scrims/[id]/actions";
import { useAction } from "@/components/common/use-action";
import type { GameProfileValue } from "@/components/profile/game-profile-form";
import { Button } from "@/components/ui/button";
import type { Game } from "@/lib/games";
import { isTeamMode, type MatchMode } from "@/lib/match-modes";
import { PHONE_ITEM, PROFILE_ITEMS } from "@/lib/profile";
import { openCheckout, PayButton, type CheckoutMode } from "./pay-button";
import { UseFreeSlotButton } from "./use-free-slot-button";

// Only players adding or fixing a game ID need this form: keep it out of the match page's first load.
const RegistrationDialog = dynamic(() =>
  import("./registration-dialog").then((m) => m.RegistrationDialog),
);

/** The viewer's ID for the match's game (null = not added yet): filled in inside the pop-up. */
export interface PlayingAs {
  game: Game;
  value: GameProfileValue | null;
  /** Has everything admins need (Free Fire/BGMI: the exact in-game name too). */
  complete: boolean;
}

export type RegistrationPanelState =
  | { kind: "ANON"; loginHref: string }
  | { kind: "INCOMPLETE"; profileHref: string; missing: string[] }
  /** No ID for this game yet, or the exact in-game name is missing: alue pre-fills what exists. */
  | { kind: "NEEDS_GAME_ID"; game: Game; value: GameProfileValue | null }
  | { kind: "UNAVAILABLE"; message: string }
  | {
      kind: "REGISTERED";
      status: "PENDING" | "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "NO_SHOW";
      waitlistRank: number | null;
      canCancel: boolean;
      teamName: string | null;
      roster: { name: string; igl: boolean; status: string }[];
      payment: { amountPaise: number; expiresAt: string; freeSlots: number } | null;
    }
  | { kind: "ROSTER_INVITE"; captainName: string; teamName: string }
  | { kind: "ON_ROSTER"; captainName: string; teamName: string; registrationStatus: string }
  | { kind: "SOLO"; mode: MatchMode; willWaitlist: boolean; playingAs: PlayingAs }
  | {
      kind: "TEAM";
      mode: MatchMode;
      size: number;
      willWaitlist: boolean;
      playingAs: PlayingAs;
      teams: SavedTeam[];
      createTeamHref: string;
    };

/** A saved team (Teams page) that can fill the registration roster; members exclude the viewer. */
export interface SavedTeam {
  id: string;
  name: string;
  members: {
    id: string;
    name: string;
    gameId: string | null;
    ign: string | null;
    /** Has a complete ID for this game, so they can be entered straight away. */
    ready: boolean;
  }[];
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: "Waiting for teammates to confirm",
  PENDING_PAYMENT: "Waiting for payment",
  CONFIRMED: "Confirmed — you have a slot",
  WAITLISTED: "On the waitlist",
  NO_SHOW: "Marked as no-show",
};

function useRegisterFlow(matchId: string, profileHref: string, checkoutMode: CheckoutMode) {
  const router = useRouter();
  const register = useAction(registerAction);
  async function run(input: {
    teamId?: string;
    memberIds?: string[];
    teamName?: string;
    players?: { gameId: string; ign?: string }[];
  }) {
    const r = await register.run({ matchId, ...input });
    // Paid entry: the slot is held; go straight to checkout.
    if (r.ok && r.data.status === "PENDING_PAYMENT")
      await openCheckout(matchId, checkoutMode, router);
    if (!r.ok && "code" in r && r.code === "PROFILE_INCOMPLETE") {
      const missing = r.fieldErrors?.missing ?? [];
      // A missing game ID is asked for right here; name, date of birth, email and the mobile
      // number (paid entry, DECISIONS M31) live on the profile.
      const onProfile = [...PROFILE_ITEMS, PHONE_ITEM] as readonly string[];
      if (!missing.some((m) => onProfile.includes(m))) router.refresh();
      else router.push(`${profileHref}&missing=${encodeURIComponent(missing.join(", "))}`);
    }
    return r;
  }
  return { run, pending: register.pending, fieldErrors: register.fieldErrors };
}

/**
 * "Register" button that opens the registration pop-up (DECISIONS M14). The pop-up's code loads
 * only when a player opens it, so the match page stays light.
 */
function RegisterLauncher({
  matchId,
  mode,
  size,
  playingAs,
  defaultTeamName,
  savedTeams = [],
  willWaitlist,
  entryFeePaise,
  profileHref,
  checkoutMode,
}: {
  matchId: string;
  mode: MatchMode;
  size: number;
  playingAs: PlayingAs;
  defaultTeamName: string;
  savedTeams?: SavedTeam[];
  willWaitlist: boolean;
  entryFeePaise: number;
  profileHref: string;
  checkoutMode: CheckoutMode;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { run, pending, fieldErrors } = useRegisterFlow(matchId, profileHref, checkoutMode);
  const team = isTeamMode(mode);
  return (
    <>
      <Button
        className="w-full"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        {willWaitlist ? "Join waitlist" : team ? "Register team" : "Register"}
      </Button>
      {team ? (
        <p className="text-muted-foreground text-xs">
          Team of {size}: you register as IGL. Use your saved team or enter your players&apos; IDs.
        </p>
      ) : null}
      {loaded ? (
        <RegistrationDialog
          open={open}
          onOpenChange={setOpen}
          mode={mode}
          size={size}
          playingAs={playingAs}
          defaultTeamName={defaultTeamName}
          savedTeams={savedTeams}
          willWaitlist={willWaitlist}
          entryFeePaise={entryFeePaise}
          pending={pending}
          fieldErrors={fieldErrors}
          onSubmit={async (input) => {
            const r = await run(input);
            if (r.ok) setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
export function RegistrationPanel({
  matchId,
  state,
  profileHref,
  checkoutMode = "stub",
  entryFeePaise = 0,
}: {
  matchId: string;
  state: RegistrationPanelState;
  profileHref: string;
  checkoutMode?: CheckoutMode;
  entryFeePaise?: number;
}) {
  const cancel = useAction(cancelRegistrationAction);
  const respond = useAction(respondToRosterAction);

  switch (state.kind) {
    case "ANON":
      return (
        <Button asChild className="w-full">
          <Link href={state.loginHref}>Log in to register</Link>
        </Button>
      );
    case "INCOMPLETE":
      return (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Before registering, add your {state.missing.join(", ")}.
          </p>
          <Button asChild className="w-full">
            <Link
              href={`${state.profileHref}&missing=${encodeURIComponent(state.missing.join(", "))}`}
            >
              Complete profile
            </Link>
          </Button>
        </div>
      );
    case "UNAVAILABLE":
      return <p className="text-muted-foreground text-sm">{state.message}</p>;
    case "SOLO":
      return (
        <div className="space-y-3">
          <RegisterLauncher
            matchId={matchId}
            mode={state.mode}
            size={1}
            playingAs={state.playingAs}
            defaultTeamName=""
            willWaitlist={state.willWaitlist}
            entryFeePaise={entryFeePaise}
            profileHref={profileHref}
            checkoutMode={checkoutMode}
          />
        </div>
      );
    case "TEAM":
      return (
        <div className="space-y-3">
          <RegisterLauncher
            matchId={matchId}
            mode={state.mode}
            size={state.size}
            playingAs={state.playingAs}
            defaultTeamName={state.teams[0]?.name ?? ""}
            savedTeams={state.teams}
            willWaitlist={state.willWaitlist}
            entryFeePaise={entryFeePaise}
            profileHref={profileHref}
            checkoutMode={checkoutMode}
          />
        </div>
      );
    case "ROSTER_INVITE":
      return (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{state.captainName}</strong> added you to <strong>{state.teamName}</strong> for
            this match. Confirm your spot so the team counts.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={respond.pending}
              onClick={() => respond.run({ matchId, accept: true })}
            >
              Confirm spot
            </Button>
            <Button
              variant="outline"
              disabled={respond.pending}
              onClick={() => respond.run({ matchId, accept: false })}
            >
              Decline
            </Button>
          </div>
        </div>
      );
    case "ON_ROSTER":
      return (
        <p className="text-sm">
          You play for <strong>{state.teamName}</strong> (captain {state.captainName}). Team status:{" "}
          {STATUS_TEXT[state.registrationStatus] ?? state.registrationStatus}.
        </p>
      );
    case "REGISTERED":
      return (
        <div className="space-y-3">
          <p className="font-medium" role="status">
            {STATUS_TEXT[state.status]}
            {state.status === "WAITLISTED" && state.waitlistRank ? ` (#${state.waitlistRank})` : ""}
          </p>
          {state.status === "PENDING_PAYMENT" && state.payment ? (
            <>
              <PayButton
                matchId={matchId}
                amountPaise={state.payment.amountPaise}
                expiresAt={state.payment.expiresAt}
                mode={checkoutMode}
              />
              {state.payment.freeSlots > 0 ? (
                <UseFreeSlotButton matchId={matchId} available={state.payment.freeSlots} />
              ) : null}
            </>
          ) : null}
          {state.teamName ? (
            <div className="text-sm">
              <p className="text-muted-foreground">{state.teamName} roster:</p>
              <ul className="mt-1 space-y-1">
                {state.roster.map((r) => (
                  <li key={r.name}>
                    {r.name}
                    {r.igl ? (
                      <span className="text-gold ml-1 text-xs font-semibold">IGL</span>
                    ) : null}{" "}
                    — {r.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.canCancel ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={cancel.pending}
              onClick={() => {
                if (
                  confirm(
                    entryFeePaise > 0
                      ? "Cancel your registration? Your slot goes to the next player on the waitlist. The entry fee is NOT refunded when you cancel."
                      : "Cancel your registration? Your slot goes to the next player on the waitlist.",
                  )
                )
                  void cancel.run({ matchId });
              }}
            >
              Cancel registration
            </Button>
          ) : null}
        </div>
      );
  }
}
