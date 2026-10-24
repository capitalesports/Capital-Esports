import { describe, expect, it } from "vitest";
import { adminMatchRows, type AdminListMatch } from "@/lib/admin-match-rows";
import type { MatchStatus } from "@/lib/match-state";

const cup = { id: "t1", title: "Clash Squad Cup #1" };
let seq = 0;
function m(
  status: MatchStatus,
  hour: number,
  opts: { cup?: boolean; entry?: boolean; regs?: number } = {},
): AdminListMatch {
  seq += 1;
  return {
    id: `m${seq}`,
    startsAt: new Date(Date.UTC(2026, 9, 23, hour)),
    status,
    isEntryList: opts.entry ?? false,
    tournament: opts.cup ? cup : null,
    _count: { registrations: opts.regs ?? 2 },
  };
}

describe("admin match rows (DECISIONS M74)", () => {
  it("shows a tournament's sign-up list and games as one row, scrims one row each", () => {
    const scrim = m("REGISTRATION_OPEN", 10);
    const rows = adminMatchRows([
      m("COMPLETED", 12, { cup: true }),
      m("REGISTRATION_CLOSED", 12, { cup: true, entry: true, regs: 9 }),
      scrim,
      m("CANCELLED", 12, { cup: true }),
      m("COMPLETED", 15, { cup: true }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "tournament",
      id: "t1",
      title: "Clash Squad Cup #1",
      games: 3,
      entries: 9,
      status: "COMPLETED",
    });
    expect(rows[1]).toEqual({ kind: "match", match: scrim });
  });

  it("status follows the game being played, else the sign-up list", () => {
    const live = adminMatchRows([
      m("COMPLETED", 12, { cup: true }),
      m("LIVE", 13, { cup: true }),
      m("REGISTRATION_CLOSED", 14, { cup: true }),
    ]);
    expect(live[0]).toMatchObject({ status: "LIVE" });
    const signUp = adminMatchRows([m("REGISTRATION_OPEN", 12, { cup: true, entry: true })]);
    expect(signUp[0]).toMatchObject({ status: "REGISTRATION_OPEN", games: 0 });
  });
});
