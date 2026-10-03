/**
 * Match the rows an AI read from result screenshots to the match's entries (DECISIONS M48).
 * Pure: the admin results editor fills its form from these suggestions and the admin checks them.
 */

/** One row as read from a screenshot. */
export interface ReadRow {
  name: string;
  placement: number | null;
  kills: number | null;
  won: boolean | null;
}

/** An entry and every name it may appear under (team name, IGNs, display names). */
export interface EntryNames {
  registrationId: string;
  names: string[];
}

export type MatchConfidence = "exact" | "close";

export interface EntrySuggestion {
  registrationId: string;
  confidence: MatchConfidence;
  /** The names as read from the screenshot that were matched to this entry. */
  readNames: string[];
  placement: number | null;
  kills: number | null;
  won: boolean | null;
}

export interface MatchOutcome {
  suggestions: EntrySuggestion[];
  /** Read rows no entry matched (e.g. a stranger in the lobby, or a name read badly). */
  unmatched: string[];
}

/** Small capitals and other look-alikes common in Free Fire names, mapped to plain letters. */
const LOOKALIKES: Record<string, string> = {
  ᴀ: "a",
  ʙ: "b",
  ᴄ: "c",
  ᴅ: "d",
  ᴇ: "e",
  ғ: "f",
  ɢ: "g",
  ʜ: "h",
  ɪ: "i",
  ᴊ: "j",
  ᴋ: "k",
  ʟ: "l",
  ᴍ: "m",
  ɴ: "n",
  ᴏ: "o",
  ᴘ: "p",
  ǫ: "q",
  ʀ: "r",
  ꜱ: "s",
  ᴛ: "t",
  ᴜ: "u",
  ᴠ: "v",
  ᴡ: "w",
  ʏ: "y",
  ᴢ: "z",
};

/** Lower-case letters and digits only, with look-alike and accented letters folded. */
export function normalizeName(name: string): string {
  return [...name.normalize("NFKD")]
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length]!;
}

/** 1 = same after normalising; otherwise 1 - edit distance / longer length. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Below this a read name is not trusted to be the entry. */
export const MATCH_THRESHOLD = 0.75;

/**
 * Give every read row to the entry whose names it resembles most (if close enough). Rows of one
 * entry (squad members) share its placement: the best (lowest) one wins, kills add up, and the
 * entry won if any of its rows won. "exact" only when every matched name was an exact match.
 */
export function matchReadRows(entries: EntryNames[], rows: ReadRow[]): MatchOutcome {
  const byEntry = new Map<string, { rows: ReadRow[]; exact: boolean }>();
  const unmatched: string[] = [];
  for (const row of rows) {
    let best: { id: string; score: number } | null = null;
    for (const e of entries) {
      for (const n of e.names) {
        const score = nameSimilarity(row.name, n);
        if (!best || score > best.score) best = { id: e.registrationId, score };
      }
    }
    if (!best || best.score < MATCH_THRESHOLD) {
      unmatched.push(row.name);
      continue;
    }
    const slot = byEntry.get(best.id) ?? { rows: [], exact: true };
    slot.rows.push(row);
    slot.exact &&= best.score === 1;
    byEntry.set(best.id, slot);
  }

  const suggestions: EntrySuggestion[] = [];
  for (const e of entries) {
    const slot = byEntry.get(e.registrationId);
    if (!slot) continue;
    const placements = slot.rows.map((r) => r.placement).filter((p): p is number => p !== null);
    const kills = slot.rows.map((r) => r.kills).filter((k): k is number => k !== null);
    const won = slot.rows.map((r) => r.won).filter((w): w is boolean => w !== null);
    suggestions.push({
      registrationId: e.registrationId,
      confidence: slot.exact ? "exact" : "close",
      readNames: slot.rows.map((r) => r.name),
      placement: placements.length ? Math.min(...placements) : null,
      kills: kills.length ? kills.reduce((a, b) => a + b, 0) : null,
      won: won.length ? won.some(Boolean) : null,
    });
  }
  return { suggestions, unmatched };
}
