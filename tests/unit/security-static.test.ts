import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp, SECURITY_HEADERS } from "@/lib/security-headers";

const ROOT = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full, match);
    return match(name) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Exported async functions with their bodies (good enough for our code style). */
function exportedFunctions(src: string): { name: string; body: string }[] {
  const parts = src.split(/export async function /).slice(1);
  return parts.map((p) => ({ name: p.slice(0, p.indexOf("(")), body: p }));
}

/** Server actions that are deliberately public, with the reason. */
const PUBLIC_ACTIONS: Record<string, string> = {
  submitContactAction: "public contact form: validated, honeypot, rate-limited per IP",
};

describe("every server action checks the caller", () => {
  const files = walk(path.join(ROOT, "app"), (n) => n === "actions.ts").filter((f) => readFileSync(f, "utf8").startsWith('"use server"'));

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  for (const file of files) {
    for (const fn of exportedFunctions(readFileSync(file, "utf8"))) {
      it(`${rel(file)} › ${fn.name}`, () => {
        if (PUBLIC_ACTIONS[fn.name]) return;
        expect(fn.body).toMatch(/await require(User|Moderator|Admin)\(\)/);
      });
    }
  }
});

describe("every service mutation asserts the actor and validates input", () => {
  const files = walk(path.join(ROOT, "server/services"), (n) => n.endsWith(".ts"));
  const checked: string[] = [];
  for (const file of files) {
    for (const fn of exportedFunctions(readFileSync(file, "utf8"))) {
      if (!/^\w+\(actor: Actor \| null/.test(fn.body)) continue;
      checked.push(fn.name);
      it(`${rel(file)} › ${fn.name}`, () => {
        expect(fn.body).toMatch(/assert(User|Moderator|Admin)\(actor\)/);
        // Functions that take input must parse it with Zod.
        if (/input: unknown/.test(fn.body.slice(0, 200))) expect(fn.body).toMatch(/parseInput\(/);
      });
    }
  }
  it("covers the services", () => expect(checked.length).toBeGreaterThan(50));
});

/** Every mutating route handler and why it is safe without a session role check. */
const ROUTE_MUTATIONS: Record<string, string> = {
  "app/api/auth/session/route.ts": "verifies OTP token server-side, same-origin check, rate limits",
  "app/api/auth/email/request/route.ts":
    "same-origin check, rate limits per IP and email, same answer for unknown emails, codes only to verified emails",
  "app/api/auth/email/verify/route.ts":
    "hashed one-time code (10 min, 5 tries, single use), same-origin check, IP rate limit, ban checks",
  "app/api/auth/google/route.ts":
    "Google ID token verified server-side (Firebase Admin; stub only off-production), same-origin check, IP rate limit, ban checks; new players only get a signed 30-min signup cookie",
  "app/api/auth/password/route.ts":
    "scrypt hashes, verified email required, same answer for unknown email/no password/wrong password, same-origin check, rate limits per IP and email, ban checks",
  "app/api/auth/signup/route.ts":
    "same-origin check, Zod validation, rate limits per IP and email, ban check, account can't log in until the emailed code is entered",
  "app/api/auth/signup/verify/route.ts":
    "hashed one-time code (10 min, 5 tries, single use) proves the email, same-origin check, IP rate limit, ban checks",
  "app/api/auth/logout/route.ts": "same-origin check; only clears the caller's cookie",
  "app/api/webhooks/cashfree/route.ts": "HMAC signature mandatory",
  "app/api/webhooks/cashfree-payouts/route.ts": "HMAC signature mandatory",
  "app/api/analytics/route.ts": "anonymous page-view beacon, path validated, rate-limited, stores no PII",
};

describe("route handlers", () => {
  const routes = walk(path.join(ROOT, "app"), (n) => n === "route.ts" || n === "route.tsx");

  it("every POST/PUT/PATCH/DELETE handler is reviewed", () => {
    const mutating = routes.filter((f) => /export async function (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(mutating.sort()).toEqual(Object.keys(ROUTE_MUTATIONS).sort());
  });

  it("webhooks verify signatures before doing anything", () => {
    const src = readFileSync(path.join(ROOT, "server/services/webhooks.ts"), "utf8");
    expect(src.match(/verifyWebhookSignature\(/g)?.length).toBe(2);
  });

  it("cron routes require the cron secret", () => {
    for (const f of routes.filter((r) => rel(r).startsWith("app/api/cron/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).toMatch(/checkCronAuth\(request\)/);
    }
  });

  it("cookie-authenticated POST routes check the origin (CSRF)", () => {
    for (const f of [
      "app/api/auth/session/route.ts",
      "app/api/auth/logout/route.ts",
      "app/api/auth/email/request/route.ts",
      "app/api/auth/email/verify/route.ts",
      "app/api/auth/password/route.ts",
      "app/api/auth/google/route.ts",
    ]) {
      expect(readFileSync(path.join(ROOT, f), "utf8")).toMatch(/assertSameOrigin\(request\)/);
    }
  });
});

describe("secrets stay on the server", () => {
  it("client components only read NEXT_PUBLIC_ env vars", () => {
    const clientFiles = [...walk(path.join(ROOT, "components"), (n) => /\.tsx?$/.test(n)), ...walk(path.join(ROOT, "app"), (n) => /\.tsx?$/.test(n))].filter((f) =>
      readFileSync(f, "utf8").startsWith('"use client"'),
    );
    expect(clientFiles.length).toBeGreaterThan(20);
    for (const f of clientFiles) {
      const envs = readFileSync(f, "utf8").match(/process\.env\.([A-Z_]+)/g) ?? [];
      for (const e of envs) expect(e === "process.env.NODE_ENV" || e.startsWith("process.env.NEXT_PUBLIC_"), `${rel(f)} reads ${e}`).toBe(true);
    }
  });

  it("server modules are marked server-only", () => {
    for (const f of walk(path.join(ROOT, "server"), (n) => n.endsWith(".ts"))) {
      if (/errors\.ts$|validation\.ts$/.test(f)) continue; // shared, secret-free helpers
      expect(readFileSync(f, "utf8"), rel(f)).toMatch(/^import "server-only";/m);
    }
  });
});

describe("security headers", () => {
  it("builds a nonce-based CSP allowing only the expected third parties", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    const hosts = csp.match(/https:\/\/[^\s;]+/g) ?? [];
    for (const h of hosts) expect(h, h).toMatch(/google\.com|gstatic\.com|googleapis\.com|firebaseapp\.com|cashfree\.com|supabase\.co|sentry\.io|youtube-nocookie\.com/);
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
  });

  it("sets HSTS, frame, type and referrer headers", () => {
    const keys = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(keys["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
    expect(keys["X-Frame-Options"]).toBe("DENY");
    expect(keys["X-Content-Type-Options"]).toBe("nosniff");
    expect(keys["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
