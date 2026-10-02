/**
 * Team join codes (DECISIONS M17): 5 capital letters, shared by the team so players can join with
 * "Join team". I and O are left out so a code read aloud or from a screenshot can't be mistyped as
 * 1 or 0 (24^5 ≈ 8 million codes).
 */
export const TEAM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TEAM_CODE_LENGTH = 5;

/** A random code; `randomInt(n)` returns an integer in [0, n). */
export function randomTeamCode(randomInt: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < TEAM_CODE_LENGTH; i++) {
    code += TEAM_CODE_ALPHABET[randomInt(TEAM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Codes are typed in any case and with stray spaces or dashes. Returns null when it can't be one. */
export function normalizeTeamCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== TEAM_CODE_LENGTH) return null;
  return [...code].every((c) => TEAM_CODE_ALPHABET.includes(c)) ? code : null;
}
