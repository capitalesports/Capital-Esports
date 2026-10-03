import "server-only";
import { z } from "zod";
import type { ReadRow } from "@/lib/result-matching";

/**
 * Reads end-of-match result screenshots into rows (DECISIONS M48). Google Gemini's API (free tier
 * available) when GEMINI_API_KEY is set; otherwise null and the admin fills the form by hand.
 */
export interface ResultReader {
  readonly kind: "gemini";
  read(
    images: { mime: string; bytes: Uint8Array }[],
    context: { game: string; mode: string; headToHead: boolean; knownNames: string[] },
  ): Promise<ReadRow[]>;
}

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * Tried in order: a model that is busy (503), missing for this key (404) or out of free quota (429)
 * hands over to the next. Rolling aliases, because Google retires fixed models for new users
 * (gemini-2.5-flash already was). GEMINI_MODEL, if set, is tried first.
 */
export const GEMINI_MODELS = [
  // Fastest first: it read test result screens as well as the bigger models, in seconds.
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
  "gemini-flash-latest",
];
/** Kept for the docs: the first model tried when GEMINI_MODEL is not set. */
export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0]!;

const rowSchema = z.object({
  name: z.string().trim().min(1).max(60),
  placement: z.number().int().min(1).max(100).nullable().optional(),
  kills: z.number().int().min(0).max(200).nullable().optional(),
  won: z.boolean().nullable().optional(),
});
const answerSchema = z.object({ rows: z.array(z.unknown()).max(200) });

/** Keep only well-formed rows; a bad row is dropped, not fatal. */
export function parseReaderAnswer(text: string): ReadRow[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The screenshot reader did not answer with JSON.");
  }
  const answer = answerSchema.parse(json);
  const rows: ReadRow[] = [];
  for (const raw of answer.rows) {
    const r = rowSchema.safeParse(raw);
    if (!r.success) continue;
    rows.push({
      name: r.data.name,
      placement: r.data.placement ?? null,
      kills: r.data.kills ?? null,
      won: r.data.won ?? null,
    });
  }
  return rows;
}

function prompt(c: Parameters<ResultReader["read"]>[1]): string {
  return [
    `You read end-of-match result screenshots from the game ${c.game} (mode: ${c.mode}).`,
    "Return every player row you can see, top to bottom, across all screenshots, without duplicates.",
    "For each row give: name = the in-game name in plain letters and digits; when a name uses decorative symbols or fancy look-alike letters, write the plain letters it spells (for example ꧁ʀᴏʜᴀɴ꧂ is ROHAN);",
    c.headToHead
      ? "won = true for players on the winning side and false for the losing side; placement and kills may be null."
      : "placement = the team's or player's final rank (1 = winner); kills = that player's kills or eliminations; won = null.",
    "Use null for anything you cannot read. Never invent rows or numbers.",
    c.knownNames.length
      ? `Registered names in this match (use them only to help read blurry text): ${c.knownNames.slice(0, 120).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

class GeminiResultReader implements ResultReader {
  readonly kind = "gemini" as const;
  constructor(
    private apiKey: string,
    private models: string[],
  ) {}

  async read(
    images: Parameters<ResultReader["read"]>[0],
    context: Parameters<ResultReader["read"]>[1],
  ) {
    const requestBody = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt(context) },
            ...images.map((img) => ({
              inline_data: {
                mime_type: img.mime,
                data: Buffer.from(img.bytes).toString("base64"),
              },
            })),
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            rows: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  placement: { type: "INTEGER", nullable: true },
                  kills: { type: "INTEGER", nullable: true },
                  won: { type: "BOOLEAN", nullable: true },
                },
                required: ["name"],
              },
            },
          },
          required: ["rows"],
        },
      },
    });
    let quotaHit = false;
    for (const model of this.models) {
      const res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        cache: "no-store",
        body: requestBody,
      });
      const body = (await res.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { status?: string; message?: string };
      };
      if (res.ok) {
        const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        return parseReaderAnswer(text);
      }
      console.error("Gemini error", model, res.status, body.error?.status);
      if (res.status === 429) quotaHit = true;
      // Busy, unknown for this key, or out of quota: try the next model. Anything else is final.
      if (![404, 429, 500, 503].includes(res.status)) throw new Error(`Gemini ${res.status}`);
    }
    throw new Error(quotaHit ? "QUOTA" : "Gemini busy");
  }
}

export function getResultReader(): ResultReader | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const preferred = process.env.GEMINI_MODEL;
  const models = preferred
    ? [preferred, ...GEMINI_MODELS.filter((m) => m !== preferred)]
    : GEMINI_MODELS;
  return new GeminiResultReader(key, models);
}
