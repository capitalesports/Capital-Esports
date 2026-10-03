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
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

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
    "For each row give: name = the in-game name exactly as shown (keep symbols and spacing);",
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
    private model: string,
  ) {}

  async read(
    images: Parameters<ResultReader["read"]>[0],
    context: Parameters<ResultReader["read"]>[1],
  ) {
    const res = await fetch(`${GEMINI_API}/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      cache: "no-store",
      body: JSON.stringify({
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
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { status?: string; message?: string };
    };
    if (!res.ok) {
      console.error("Gemini error", res.status, body.error?.status);
      if (res.status === 429) throw new Error("QUOTA");
      throw new Error(`Gemini ${res.status}`);
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseReaderAnswer(text);
  }
}

export function getResultReader(): ResultReader | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiResultReader(key, process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
}
