import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readResultScreenshots, SCREENSHOTS_PER_READ } from "@/server/services/result-screenshots";
import type { Actor } from "@/lib/roles";
import { createMatch, createPlayer, createUser, resetDb, testDb } from "../helpers/db";

/** DECISIONS M48: staff upload result screenshots, Gemini reads them (faked here), we match names. */

// A 1x1 PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

let geminiAnswer: { status: number; body: unknown } = { status: 200, body: {} };
const geminiCalls: { url: string; body: { contents: { parts: unknown[] }[] } }[] = [];
const realFetch = globalThis.fetch;
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (!url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input, init);
  geminiCalls.push({ url, body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify(geminiAnswer.body), { status: geminiAnswer.status });
}
function answer(rows: unknown[]) {
  geminiAnswer = {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ rows }) }] } }] },
  };
}

let admin: Actor;
let mod: Actor;

async function brMatch() {
  const m = await createMatch(admin.id, {
    game: "FREE_FIRE",
    mode: "SOLO",
    status: "RESULTS_PENDING",
  });
  const players: { id: string; regId: string }[] = [];
  for (const [name, ign] of [
    ["Rohan", "꧁ʀᴏʜᴀɴ꧂"],
    ["Khushi", "khushi"],
    ["Yuvi", "XB Yuvraj"],
  ] as const) {
    const p = await createPlayer("FREE_FIRE", { displayName: name });
    await testDb().gameProfile.updateMany({
      where: { userId: p.id, game: "FREE_FIRE" },
      data: { ign },
    });
    const reg = await testDb().registration.create({
      data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: players.length + 1 },
    });
    players.push({ ...p, regId: reg.id });
  }
  return { m, players };
}

beforeAll(() => vi.stubGlobal("fetch", fakeFetch));
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await resetDb();
  process.env.GEMINI_API_KEY = "test-gemini-key";
  geminiCalls.length = 0;
  admin = { id: (await createUser({ role: "ADMIN" })).id, role: "ADMIN" };
  mod = { id: (await createUser({ role: "MODERATOR" })).id, role: "MODERATOR" };
});
afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("reading result screenshots", () => {
  it("fills placement and kills for the matched players and lists strangers", async () => {
    const { m, players } = await brMatch();
    answer([
      { name: "ROHAN", placement: 1, kills: 7 },
      { name: "XB Yuvrai", placement: 2, kills: 3 },
      { name: "Somebody Else", placement: 3, kills: 1 },
    ]);
    const out = await readResultScreenshots(mod, { matchId: m.id }, [PNG]);
    expect(out.rowsRead).toBe(3);
    expect(out.suggestions).toEqual([
      expect.objectContaining({
        registrationId: players[0]!.regId,
        confidence: "exact",
        placement: 1,
        kills: 7,
      }),
      expect.objectContaining({
        registrationId: players[2]!.regId,
        confidence: "close",
        placement: 2,
        kills: 3,
      }),
    ]);
    expect(out.unmatched).toEqual(["Somebody Else"]);
    // The image went to Gemini with the registered names as a reading hint; nothing was saved.
    const parts = geminiCalls[0]!.body.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(JSON.stringify(parts[0])).toContain("XB Yuvraj");
    expect(await testDb().result.count()).toBe(0);
  });

  it("only staff can read, and the input is validated", async () => {
    const { m, players } = await brMatch();
    answer([]);
    const player: Actor = { id: players[0]!.id, role: "PLAYER" };
    await expect(readResultScreenshots(player, { matchId: m.id }, [PNG])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(readResultScreenshots(null, { matchId: m.id }, [PNG])).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(readResultScreenshots(mod, {}, [PNG])).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(readResultScreenshots(mod, { matchId: m.id }, [])).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const tooMany = Array.from({ length: SCREENSHOTS_PER_READ + 1 }, () => PNG);
    await expect(readResultScreenshots(mod, { matchId: m.id }, tooMany)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      readResultScreenshots(mod, { matchId: m.id }, [new TextEncoder().encode("not an image")]),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(geminiCalls).toHaveLength(0);
  });

  it("works only while results are pending", async () => {
    const m = await createMatch(admin.id, { status: "REGISTRATION_OPEN" });
    await expect(readResultScreenshots(admin, { matchId: m.id }, [PNG])).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("says so when no Gemini key is set or the free quota is used up", async () => {
    const { m } = await brMatch();
    delete process.env.GEMINI_API_KEY;
    await expect(readResultScreenshots(mod, { matchId: m.id }, [PNG])).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("isn't set up"),
    });
    process.env.GEMINI_API_KEY = "test-gemini-key";
    geminiAnswer = { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } };
    await expect(readResultScreenshots(mod, { matchId: m.id }, [PNG])).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("limit is used up"),
    });
  });

  it("marks the winner of a head-to-head match", async () => {
    const m = await createMatch(admin.id, {
      game: "FREE_FIRE",
      mode: "ONE_V_ONE",
      status: "RESULTS_PENDING",
    });
    const regs: { id: string }[] = [];
    for (const name of ["Alpha", "Bravo"]) {
      const p = await createPlayer("FREE_FIRE", { displayName: name });
      regs.push(
        await testDb().registration.create({
          data: { matchId: m.id, userId: p.id, status: "CONFIRMED", position: regs.length + 1 },
        }),
      );
    }
    answer([
      { name: "Alpha", won: false },
      { name: "Bravo", won: true },
    ]);
    const out = await readResultScreenshots(admin, { matchId: m.id }, [PNG]);
    expect(out.suggestions.map((s) => [s.registrationId, s.won])).toEqual([
      [regs[0]!.id, false],
      [regs[1]!.id, true],
    ]);
  });
});
