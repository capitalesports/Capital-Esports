import { IntentLink as Link } from "@/components/common/intent-link";
import { Artwork } from "@/components/common/artwork";
import { SpriteIcon } from "@/components/common/icon-sprite";
import { artKey } from "@/lib/artwork";
import { GAME_CONFIG } from "@/lib/games";
import { MODE_LABEL } from "@/lib/match-schema";
import { formatEntryFee, formatINR } from "@/lib/money";
import { CARD_ACTION_LABEL, cardAction } from "@/lib/registration-rules";
import { lobbiesNeeded, lobbyNoun, lobbyWord } from "@/lib/lobbies";
import { scrimIsOpenEntry, scrimPill } from "@/lib/scrims-filter";
import { addDays, formatClockIST, istDayKey, shortDateIST, shortWeekdayIST } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PublicMatch } from "@/server/queries/matches";
import { ScrimStatusPill } from "./scrim-status-pill";

/** "Today" / "Tomorrow" / "Tue, 29 Sep" by IST calendar day. */
function dayWord(date: Date, now: Date): string {
  const key = istDayKey(date);
  if (key === istDayKey(now)) return "Today";
  if (key === istDayKey(addDays(now, 1))) return "Tomorrow";
  return `${shortWeekdayIST(date)}, ${shortDateIST(date)}`;
}

/**
 * Match card from docs/design/pages/scrims-desktop.png. `day` (Today's Scrims, home row): clock row
 * "06:00 PM · Today" and labelled amounts. `upcoming`: calendar row "28 Sep · 10:00 AM" and bare
 * amounts. Times are IST without the "IST" suffix (DECISIONS M26; the footer says times are IST). The button says "Join Now" for today's matches and "Register" for later ones; which
 * button shows at all still comes from the registration rules (`cardAction`).
 */
export function MatchCard({
  match,
  paymentsEnabled,
  now = new Date(),
  href = `/scrims/${match.id}`,
  variant = "day",
}: {
  match: PublicMatch;
  paymentsEnabled: boolean;
  now?: Date;
  href?: string;
  variant?: "day" | "upcoming";
}) {
  const filled = match._count.registrations;
  const openEntry = scrimIsOpenEntry(match);
  const action = cardAction({ ...match, confirmedCount: filled, openEntry }, now, paymentsEnabled);
  const pill = scrimPill(match, now, paymentsEnabled);
  const actionable = action === "REGISTER" || action === "WAITLIST";
  const isToday = istDayKey(match.startsAt) === istDayKey(now);
  const label = action === "REGISTER" && !isToday ? "Register" : CARD_ACTION_LABEL[action];
  const cfg = GAME_CONFIG[match.game];
  const cap = Math.max(1, match.maxSlots);
  // Open entry never fills: the bar shows the lobby currently filling (a new one opens after it).
  const inLobby = openEntry && filled > 0 ? ((filled - 1) % cap) + 1 : filled;
  const pct = Math.min(100, Math.round((inLobby / cap) * 100));
  const lobbies = openEntry ? lobbiesNeeded(filled, match.maxSlots, match.mode) : 1;
  const word = lobbyWord(match.mode).toLowerCase();
  const upcoming = variant === "upcoming";

  return (
    <article
      aria-label={match.title}
      className={cn(
        "card-ds-interactive relative isolate flex h-full flex-col overflow-hidden p-4",
        cfg.accent.borderSoft,
      )}
    >
      {/* Card art on the right 40%, subject anchored right; the text column stays in the left 60%. */}
      <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-2/5">
        <Artwork
          name={`card-match-${artKey(match.game)}`}
          placeholderBorder={false}
          sizes="(min-width: 1280px) 140px, 40vw"
          className="object-right"
        />
        <span className="from-surface via-surface/30 absolute inset-0 bg-gradient-to-r to-transparent" />
      </div>

      <div className="flex items-start gap-2">
        <div className="flex min-h-5 items-center gap-2">
          <SpriteIcon name="trophy" className={cn("size-4", cfg.accent.text)} />
          <span className="font-heading text-sm font-bold tracking-wide whitespace-nowrap uppercase">
            {cfg.name}
          </span>
          <span className="border-border bg-background/60 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase">
            <SpriteIcon name="star" className="size-2.5" />
            {MODE_LABEL[match.mode]}
          </span>
        </div>
        {pill ? <ScrimStatusPill pill={pill} className="ml-auto" /> : null}
      </div>

      <h3 className="mt-2 max-w-[60%] text-lg leading-tight font-bold">
        <Link
          href={href}
          className="hover:text-gold after:absolute after:inset-0 after:content-['']"
        >
          {match.title}
        </Link>
      </h3>
      {upcoming ? (
        <p className="text-muted-foreground mt-1 flex max-w-[60%] items-center gap-1.5 text-xs">
          <SpriteIcon name="calendar-days" className="size-3.5" />
          {shortDateIST(match.startsAt)} · {formatClockIST(match.startsAt)}
        </p>
      ) : (
        <p className="text-muted-foreground mt-1 flex max-w-[60%] items-center gap-1.5 text-xs">
          <SpriteIcon name="clock" className="size-3.5" />
          {formatClockIST(match.startsAt)} · {dayWord(match.startsAt, now)}
        </p>
      )}

      <dl className="mt-3 flex max-w-[60%] gap-6">
        <div>
          <dt className={cn("text-muted-foreground text-xs", upcoming && "sr-only")}>Prize Pool</dt>
          <dd className="font-heading text-lg font-bold">
            {match.prizePaise ? formatINR(match.prizePaise) : "—"}
          </dd>
        </div>
        <div>
          <dt className={cn("text-muted-foreground text-xs", upcoming && "sr-only")}>Entry Fee</dt>
          <dd className="font-heading text-lg font-bold">{formatEntryFee(match.entryFeePaise)}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-end gap-3 pt-3">
        <div className="min-w-0 flex-1">
          <div
            role="progressbar"
            aria-label={openEntry ? `Current ${word} filled` : "Slots filled"}
            aria-valuemin={0}
            aria-valuemax={match.maxSlots}
            aria-valuenow={inLobby}
            className="bg-border h-1.5 overflow-hidden rounded-full"
          >
            <div
              className={cn("h-full rounded-full", cfg.accent.bg)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-foreground mt-1 text-right text-xs">
            {openEntry
              ? `${filled} joined · ${lobbies > 1 ? `${lobbies} ${lobbyNoun(match.mode, lobbies)}` : `${match.maxSlots} per ${word}`}`
              : `${filled} / ${match.maxSlots} Slots`}
          </p>
        </div>
        <Link
          href={href}
          aria-label={`${label}: ${match.title}`}
          className={cn(
            "min-h-tap relative z-10 inline-flex shrink-0 items-center rounded-lg border px-5 text-sm font-semibold",
            // Both states get a dark backing: the button sits over the card art.
            actionable
              ? "border-gold bg-background/60 text-gold hover:bg-gold hover:text-background"
              : "border-border bg-background/70 text-muted-foreground",
          )}
        >
          {label}
        </Link>
      </div>
    </article>
  );
}
