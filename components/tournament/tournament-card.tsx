import { IntentLink as Link } from "@/components/common/intent-link";
import { GameBadge } from "@/components/game/game-badge";
import { GAME_CONFIG, type Game } from "@/lib/games";
import { gameModeLabel } from "@/lib/home";
import type { MatchMode } from "@/lib/match-modes";
import { formatEntryFee, formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface TournamentCardData {
  id: string;
  game: Game;
  mode: MatchMode;
  title: string;
  startsAt: Date;
  prizePoolPaise: number;
  winnersPublishedAt?: Date | null;
  entry: {
    status: string;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date;
    entryFeePaise: number;
  } | null;
}

/** Badge text and colour for where a tournament stands (DECISIONS M68). */
function stage(t: TournamentCardData): { label: string; className: string } {
  if (t.winnersPublishedAt)
    return { label: "Finished", className: "bg-muted text-muted-foreground" };
  switch (t.entry?.status) {
    case "REGISTRATION_OPEN":
      return { label: "Registration open", className: "bg-success/15 text-success" };
    case "UPCOMING":
      return { label: "Coming soon", className: "bg-gold/15 text-gold" };
    default:
      return { label: "In progress", className: "bg-destructive/15 text-destructive" };
  }
}

/**
 * One tournament as a card (DECISIONS M68): mode, title, stage, prize pool, entry fee, start and
 * the registration time. Used for the /tournament list and to switch between a game's tournaments.
 */
export function TournamentCard({
  t,
  href,
  active = false,
}: {
  t: TournamentCardData;
  href: string;
  /** The one shown below on a game's tournament page. */
  active?: boolean;
}) {
  const cfg = GAME_CONFIG[t.game];
  const s = stage(t);
  const open = t.entry?.status === "REGISTRATION_OPEN";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "card-ds-interactive block h-full space-y-3 p-4",
        active ? "border-gold ring-gold/30 ring-2" : cfg.accent.borderSoft,
      )}
    >
      <div className="flex items-center gap-2">
        <GameBadge game={t.game} />
        <span className="text-muted-foreground text-sm">{gameModeLabel(t.game, t.mode)}</span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
            s.className,
          )}
        >
          {s.label}
        </span>
      </div>
      <h3 className="text-lg font-bold">{t.title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Prize pool</dt>
        <dd className="text-gold font-semibold">{formatINR(t.prizePoolPaise)}</dd>
        <dt className="text-muted-foreground">Entry</dt>
        <dd>{formatEntryFee(t.entry?.entryFeePaise ?? 0)}</dd>
        <dt className="text-muted-foreground">Starts</dt>
        <dd>{formatIST(t.startsAt)}</dd>
        {t.entry && (open || t.entry.status === "UPCOMING") ? (
          <>
            <dt className="text-muted-foreground">
              {open ? "Registration closes" : "Registration opens"}
            </dt>
            <dd>
              {open
                ? formatIST(t.entry.registrationClosesAt)
                : t.entry.registrationOpensAt
                  ? formatIST(t.entry.registrationOpensAt)
                  : "Soon"}
            </dd>
          </>
        ) : null}
      </dl>
    </Link>
  );
}
