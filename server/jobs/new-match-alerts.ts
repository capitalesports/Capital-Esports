import "server-only";
import { db } from "@/server/db";
import { notify } from "@/server/services/notify";
import {
  scrimsOpenedAlert,
  tournamentAnnouncedAlert,
  tournamentOpenedAlert,
  type AlertMessage,
} from "@/lib/new-match-alerts";

/** Every active player (not deleted, not banned): they all get new scrim / tournament alerts. */
async function everyPlayerId(now: Date): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      role: "PLAYER",
      deletedAt: null,
      OR: [{ bannedAt: null }, { bannedUntil: { lte: now } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Runs with the 5-minute job (DECISIONS M64): tells every player when a tournament is announced,
 * when a tournament's or a scrim's registration opens. Each one is claimed with a conditional
 * update before sending, so overlapping runs never send twice. Scrims opening together go out as
 * one alert. Slot confirmations and the 30-minute reminder stay with the registered players only.
 */
export async function runNewMatchAlerts(now = new Date()) {
  const messages: AlertMessage[] = [];

  // Tournaments announced with registration opening later.
  const announced = await db.tournament.findMany({
    where: { announcedAt: null, cancelledAt: null, entryList: { status: "UPCOMING" } },
    select: {
      id: true,
      title: true,
      game: true,
      startsAt: true,
      prizePoolPaise: true,
      entryList: { select: { registrationOpensAt: true } },
    },
  });
  for (const t of announced) {
    const { count } = await db.tournament.updateMany({
      where: { id: t.id, announcedAt: null },
      data: { announcedAt: now },
    });
    if (count)
      messages.push(tournamentAnnouncedAlert({ ...t, opensAt: t.entryList?.registrationOpensAt }));
  }

  // Registration open now (tournament sign-up lists and standalone scrims), not yet announced.
  const opened = await db.match.findMany({
    where: {
      openNoticeSentAt: null,
      status: "REGISTRATION_OPEN",
      registrationClosesAt: { gt: now },
      OR: [
        { isEntryList: true },
        { isEntryList: false, tournamentId: null, parentMatchId: null, bracketRound: null },
      ],
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      game: true,
      startsAt: true,
      entryFeePaise: true,
      isEntryList: true,
      entryFor: {
        select: {
          id: true,
          title: true,
          game: true,
          startsAt: true,
          prizePoolPaise: true,
          cancelledAt: true,
        },
      },
    },
  });
  const scrims = [];
  for (const m of opened) {
    const { count } = await db.match.updateMany({
      where: { id: m.id, openNoticeSentAt: null },
      data: { openNoticeSentAt: now },
    });
    if (!count) continue;
    if (!m.isEntryList) scrims.push(m);
    else if (m.entryFor && !m.entryFor.cancelledAt) {
      // An announcement isn't needed any more once registration is open.
      await db.tournament.updateMany({
        where: { id: m.entryFor.id, announcedAt: null },
        data: { announcedAt: now },
      });
      messages.push(tournamentOpenedAlert(m.entryFor));
    }
  }
  const scrimAlert = scrimsOpenedAlert(scrims);
  if (scrimAlert) messages.push(scrimAlert);

  if (!messages.length) return { newMatchAlerts: 0 };
  const userIds = await everyPlayerId(now);
  for (const m of messages) await notify({ type: "ANNOUNCEMENT", userIds, ...m });
  return { newMatchAlerts: messages.length };
}
