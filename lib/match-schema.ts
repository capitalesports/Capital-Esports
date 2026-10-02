import { z } from "zod";
import { GAMES } from "./games";
import { rupeesToPaise } from "./money";
import { addMinutes, istInputToUtc } from "./time";

export * from "./match-modes";
import {
  MATCH_KINDS,
  MATCH_MODES,
  MODE_LABEL,
  MODES_FOR_GAME,
  isHeadToHead,
  maxSlotsFor,
} from "./match-modes";

const DEFAULT_CLOSE_OFFSET_MINUTES = 30;

const moneyField = z.union([z.string(), z.number()]).transform((v, ctx) => {
  if (v === "" || v === undefined) return 0;
  const paise = rupeesToPaise(v);
  if (paise === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount in rupees, e.g. 50 or 49.50" });
    return z.NEVER;
  }
  return paise;
});

const istDateTime = (label: string) =>
  z.string().transform((v, ctx) => {
    const d = istInputToUtc(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `${label}: pick a date and time` });
      return z.NEVER;
    }
    return d;
  });

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      const u = new URL(v);
      if (u.protocol !== "https:") throw new Error();
      return u.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full https:// link" });
      return z.NEVER;
    }
  });

/** Admin create/edit form. Times are entered in IST and returned as UTC Dates; money as paise. */
export const matchFormSchema = z
  .object({
    game: z.enum(GAMES),
    kind: z.enum(MATCH_KINDS).default("SCRIM"),
    mode: z.enum(MATCH_MODES),
    title: z.string().trim().min(3, "Title is too short").max(80, "Title is too long"),
    description: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
    startsAt: istDateTime("Start time"),
    registrationOpensAt: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const d = istInputToUtc(v);
        if (!d) {
          ctx.addIssue({ code: "custom", message: "Registration opens: pick a date and time" });
          return z.NEVER;
        }
        return d;
      }),
    closeOffsetMinutes: z.coerce
      .number()
      .int()
      .min(0, "Must be 0 or more")
      .max(24 * 60, "At most 24 hours")
      .default(DEFAULT_CLOSE_OFFSET_MINUTES),
    // No max field: capacity follows the game and mode (full lobby, or 2 sides head-to-head).
    minSlots: z.coerce.number().int().min(0, "Must be 0 or more").default(2),
    entryFee: moneyField,
    prize: moneyField,
    streamUrl: optionalUrl,
    tournamentId: z
      .string()
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((m, ctx) => {
    if (!MODES_FOR_GAME[m.game].includes(m.mode)) {
      ctx.addIssue({
        code: "custom",
        path: ["mode"],
        message: "This mode is not available for the chosen game",
      });
    }
    const capacity = maxSlotsFor(m.game, m.mode);
    if (m.minSlots > capacity) {
      ctx.addIssue({
        code: "custom",
        path: ["minSlots"],
        message: isHeadToHead(m.mode)
          ? `${MODE_LABEL[m.mode]} matches have 2 sides: at most 2`
          : `At most ${capacity} (a full lobby)`,
      });
    }
    const closesAt = addMinutes(m.startsAt, -m.closeOffsetMinutes);
    if (m.registrationOpensAt && m.registrationOpensAt >= closesAt) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationOpensAt"],
        message: "Registration must open before it closes",
      });
    }
    if (m.kind === "TOURNAMENT" && !m.tournamentId) {
      ctx.addIssue({
        code: "custom",
        path: ["tournamentId"],
        message: "Link the tournament this match belongs to",
      });
    }
  })
  .transform((m) => ({
    game: m.game,
    kind: m.kind,
    mode: m.mode,
    title: m.title,
    description: m.description,
    startsAt: m.startsAt,
    registrationOpensAt: m.registrationOpensAt,
    registrationClosesAt: addMinutes(m.startsAt, -m.closeOffsetMinutes),
    maxSlots: maxSlotsFor(m.game, m.mode),
    minSlots: m.minSlots,
    entryFeePaise: m.entryFee,
    prizePaise: m.prize,
    streamUrl: m.streamUrl,
    tournamentId: m.tournamentId,
  }));

export type MatchFormInput = z.input<typeof matchFormSchema>;
export type MatchData = z.output<typeof matchFormSchema>;

export const cloneSchema = z.object({
  matchId: z.string().min(1),
  startsAt: istDateTime("New start time"),
});

export const bulkCloneSchema = z.object({
  matchId: z.string().min(1),
  days: z.coerce.number().int().min(1, "At least 1 day").max(14, "At most 14 days"),
});

export const roomCredentialsSchema = z.object({
  matchId: z.string().min(1),
  roomId: z.string().trim().min(1, "Room ID is required").max(64),
  /** Required for Free Fire / BGMI; Valorant has only a code (checked in setRoomCredentials). */
  roomPassword: z.string().trim().max(64).optional(),
});

export const cancelSchema = z.object({
  matchId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});
