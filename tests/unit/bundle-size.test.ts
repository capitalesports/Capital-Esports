import { describe, expect, it } from "vitest";
import { compare, MAX_GROWTH, routeOf } from "../../scripts/check-bundle-size.mjs";

const base = {
  next: "16.3.6",
  chunks: { "next-runtime[0]": { label: "runtime", gzip: 10_000 }, "app:abc": { label: "components/x.tsx", gzip: 5_000 } },
  routes: { "/scrims": 100_000, "/": 90_000 },
  other: 20_000,
};
const current = (patch: object = {}) => ({ ...structuredClone(base), leaks: [] as string[], ...patch });

describe("bundle size budget", () => {
  it("maps manifest keys to routes", () => {
    expect(routeOf("/(site)/scrims/(list)/page")).toBe("/scrims");
    expect(routeOf("/(site)/page")).toBe("/");
    expect(routeOf("/admin/matches/[id]/edit/page")).toBe("/admin/matches/[id]/edit");
  });

  it("allows growth up to 20% and fails beyond it, per chunk and per route", () => {
    expect(MAX_GROWTH).toBe(0.2);
    expect(compare(current(), base).failures).toEqual([]);
    const ok = current({ chunks: { ...base.chunks, "app:abc": { label: "components/x.tsx", gzip: 6_000 } } });
    expect(compare(ok, base).failures).toEqual([]);
    const bigChunk = current({ chunks: { ...base.chunks, "app:abc": { label: "components/x.tsx", gzip: 6_001 } } });
    expect(compare(bigChunk, base).failures).toEqual([expect.stringMatching(/^chunk app:abc .*\+20%/)]);
    const bigRoute = current({ routes: { ...base.routes, "/scrims": 130_000 } });
    expect(compare(bigRoute, base).failures).toEqual([expect.stringMatching(/^route \/scrims first-load JS: .*\+30%/)]);
    expect(compare(current({ other: 25_000 }), base).failures).toHaveLength(1);
  });

  it("reports new chunks and routes without failing, and shrinking is fine", () => {
    const grown = current({ chunks: { ...base.chunks, "app:new": { label: "components/y.tsx", gzip: 50_000 } }, routes: { ...base.routes, "/games": 80_000 } });
    const { failures, notes } = compare(grown, base);
    expect(failures).toEqual([]);
    expect(notes).toEqual(expect.arrayContaining([expect.stringMatching(/^new: chunk app:new/), expect.stringMatching(/^new: route \/games/)]));
    expect(compare(current({ routes: { "/scrims": 10, "/": 10 } }), base).failures).toEqual([]);
  });

  it("fails on a server-only library in the client bundle", () => {
    expect(compare(current({ leaks: ["zod in static/chunks/x.js"] }), base).failures).toEqual(["server-only library in the browser bundle: zod in static/chunks/x.js"]);
  });
});
