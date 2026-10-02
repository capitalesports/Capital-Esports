import { describe, expect, it } from "vitest";
import { findViolations, runtimeImports } from "../../scripts/check-client-imports.mjs";

describe("client import audit", () => {
  it("collects runtime imports and ignores type-only ones", () => {
    const src = `
"use client";
import { useState } from "react";
import type { Game } from "@/lib/games";
import { type MatchMode, type MatchKind } from "@/lib/match-schema";
import { MODE_LABEL, type MatchMode as M } from "@/lib/match-modes";
export { thing } from "./thing";
export type { Other } from "./other";
import "./side-effect.css";
const Sheet = dynamic(() => import("./filter-sheet"));
`;
    expect(runtimeImports(src).sort()).toEqual(["./filter-sheet", "./side-effect.css", "./thing", "@/lib/match-modes", "react"].sort());
  });

  it("finds no server-only code reachable from client components", () => {
    const { violations, entries } = findViolations();
    expect(entries).toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });
});
