/**
 * Seed: one admin (ADMIN_PHONE), one active season per game, points tables, home page settings,
 * 6 sample matches over the next 3 days.
 * Idempotent: safe to run repeatedly.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Game, type MatchMode } from "../generated/prisma/client";
import { normalizePhone } from "../lib/validators";
import { addDays, addMinutes, istInputToUtc, istDayKey } from "../lib/time";
import { GAME_CONFIG, GAMES } from "../lib/games";
import { maxSlotsFor } from "../lib/match-modes";
import { defaultPointsConfig } from "../lib/points";
import { HOME_DEFAULTS, HOME_SETTING_KEYS, type HomeSettingField } from "../lib/content-keys";

export async function seed(prisma: PrismaClient, now = new Date()) {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE ?? "");
  if (!adminPhone) throw new Error("Set ADMIN_PHONE (E.164, e.g. +919876543210) before seeding");

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    create: { phone: adminPhone, role: "ADMIN", displayName: "Admin" },
    update: { role: "ADMIN" },
  });

  // First season: today (IST) + 3 months. See docs/DECISIONS.md.
  const seasonStart = istInputToUtc(`${istDayKey(now)}T00:00`)!;
  const seasonEnd = new Date(seasonStart);
  seasonEnd.setUTCMonth(seasonEnd.getUTCMonth() + 3);
  for (const game of GAMES) {
    const active = await prisma.season.findFirst({ where: { game, isActive: true } });
    if (!active) {
      await prisma.season.create({
        data: { game, name: "Season 1", startsAt: seasonStart, endsAt: seasonEnd, isActive: true },
      });
    }
  }

  // Points tables (Phase 4). Existing admin-tuned values are kept.
  for (const game of GAMES) {
    const d = defaultPointsConfig(game);
    await prisma.pointsConfig.upsert({ where: { game }, create: { game, ...d }, update: {} });
  }

  // Home page settings: the design's demo stats and default taglines until an admin changes them
  // (Admin → Content → Home page). Existing values are kept.
  for (const [field, key] of Object.entries(HOME_SETTING_KEYS) as [HomeSettingField, string][]) {
    const value = HOME_DEFAULTS[field];
    const body = typeof value === "boolean" ? String(value) : (value ?? "");
    await prisma.siteContent.upsert({ where: { key }, create: { key, body }, update: {} });
  }

  const existing = await prisma.match.count();
  if (existing > 0) return { admin, createdMatches: 0 };

  const today = istDayKey(now);
  const at = (dayOffset: number, time: string) =>
    istInputToUtc(`${istDayKey(addDays(istInputToUtc(`${today}T12:00`)!, dayOffset))}T${time}`)!;

  const samples: {
    game: Game;
    mode: MatchMode;
    title: string;
    startsAt: Date;
    prizePaise: number;
    open: boolean;
  }[] = [
    {
      game: "FREE_FIRE",
      mode: "SQUAD",
      title: "Free Fire Evening Squad Scrim",
      startsAt: at(0, "21:00"),
      prizePaise: 50000,
      open: true,
    },
    {
      game: "BGMI",
      mode: "SQUAD",
      title: "BGMI Night Squad Scrim",
      startsAt: at(0, "22:00"),
      prizePaise: 50000,
      open: true,
    },
    {
      game: "FREE_FIRE",
      mode: "SOLO",
      title: "Free Fire Solo Rush",
      startsAt: at(1, "19:00"),
      prizePaise: 0,
      open: true,
    },
    {
      game: "BGMI",
      mode: "DUO",
      title: "BGMI Duo Scrim",
      startsAt: at(1, "20:30"),
      prizePaise: 30000,
      open: false,
    },
    {
      game: "VALORANT",
      mode: "FIVE_V_FIVE",
      title: "Valorant 5v5 Showmatch",
      startsAt: at(2, "20:00"),
      prizePaise: 100000,
      open: false,
    },
    {
      game: "VALORANT",
      mode: "FIVE_V_FIVE",
      title: "Valorant 5v5 Scrim",
      startsAt: at(3, "21:00"),
      prizePaise: 0,
      open: false,
    },
  ];

  for (const s of samples) {
    await prisma.match.create({
      data: {
        game: s.game,
        kind: "SCRIM",
        mode: s.mode,
        title: s.title,
        startsAt: s.startsAt,
        registrationOpensAt: s.open ? null : addDays(s.startsAt, -1),
        registrationClosesAt: addMinutes(s.startsAt, -30),
        maxSlots: maxSlotsFor(s.game, s.mode),
        entryFeePaise: 0,
        prizePaise: s.prizePaise,
        status: s.open ? "REGISTRATION_OPEN" : "UPCOMING",
        createdById: admin.id,
        description: `${GAME_CONFIG[s.game].name} ${s.mode.toLowerCase().replace(/_/g, " ")} lobby.`,
      },
    });
  }
  return { admin, createdMatches: samples.length };
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const result = await seed(prisma);
    console.log(`Seeded admin ${result.admin.phone}; created ${result.createdMatches} matches.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
