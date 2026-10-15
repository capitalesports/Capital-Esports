/**
 * "New scrim / tournament" alerts sent to every player (DECISIONS M64). Pure: builds the
 * notification text; the job in server/jobs/new-match-alerts.ts decides when and to whom.
 */
import { GAME_CONFIG, type Game } from "./games";
import { formatEntryFee, formatINR } from "./money";
import { formatIST } from "./time";

export interface AlertMessage {
  title: string;
  body: string;
  url: string;
}

export interface OpenedScrim {
  id: string;
  title: string;
  game: Game;
  startsAt: Date;
  entryFeePaise: number;
}

export interface AlertTournament {
  id: string;
  title: string;
  game: Game;
  startsAt: Date;
  prizePoolPaise: number;
  /** When registration opens (announcements only; null = soon). */
  opensAt?: Date | null;
}

/** Scrims whose registration opened since the last run: one alert, however many there are. */
export function scrimsOpenedAlert(scrims: OpenedScrim[]): AlertMessage | null {
  if (!scrims.length) return null;
  if (scrims.length === 1) {
    const s = scrims[0]!;
    return {
      title: `New scrim open: ${s.title}`,
      body: `${GAME_CONFIG[s.game].name} · starts ${formatIST(s.startsAt)} · entry ${formatEntryFee(s.entryFeePaise)}. Book your slot now.`,
      url: `/scrims/${s.id}`,
    };
  }
  const names = scrims.slice(0, 3).map((s) => s.title);
  const more = scrims.length > 3 ? ` and ${scrims.length - 3} more` : "";
  return {
    title: `${scrims.length} new scrims open`,
    body: `${names.join(" · ")}${more}. Book your slot now.`,
    url: "/scrims",
  };
}

const tournamentUrl = (t: AlertTournament) => `/tournament/${GAME_CONFIG[t.game].slug}?t=${t.id}`;

export function tournamentOpenedAlert(t: AlertTournament): AlertMessage {
  return {
    title: `Registration open: ${t.title}`,
    body: `${GAME_CONFIG[t.game].name} tournament · prize pool ${formatINR(t.prizePoolPaise)} · starts ${formatIST(t.startsAt)}. Register now.`,
    url: tournamentUrl(t),
  };
}

export function tournamentAnnouncedAlert(t: AlertTournament): AlertMessage {
  return {
    title: `New tournament: ${t.title}`,
    body: `${GAME_CONFIG[t.game].name} · prize pool ${formatINR(t.prizePoolPaise)} · registration opens ${t.opensAt ? formatIST(t.opensAt) : "soon"}.`,
    url: tournamentUrl(t),
  };
}
