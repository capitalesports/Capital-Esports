// Fails if any client component ("use client", or anything it imports) reaches a server-only library.
// Zod once shipped 83 KB to /scrims through a client form importing lib/match-schema.ts; this keeps that
// class of mistake out. Type-only imports are ignored (they are erased at build time).
//
// Usage: node scripts/check-client-imports.mjs            (exit 1 on violations)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "components", "lib"];
const EXTRA_ENTRIES = ["instrumentation-client.ts"];
const EXTS = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** Packages that must never reach the browser (server runtime, secrets, or heavy server-side validation). */
const FORBIDDEN_PACKAGES = new Map([
  ["zod", "validation belongs on the server; import constants from a Zod-free module (e.g. lib/match-modes.ts)"],
  ["server-only", "server-only module"],
  ["@prisma/client", "database client"],
  ["@prisma/adapter-pg", "database driver"],
  ["pg", "database driver"],
  ["jose", "session signing"],
  ["firebase-admin", "server SDK with credentials"],
  ["web-push", "server push sender"],
  ["cashfree-pg", "payment gateway server SDK"],
  ["@sentry/node", "server SDK"],
]);
/** Local folders that are server-only by convention. */
const FORBIDDEN_DIRS = ["server/", "generated/prisma/", "prisma/"];
const NODE_BUILTINS = new Set(["fs", "path", "crypto", "os", "child_process", "net", "tls", "http", "https", "zlib", "stream"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const LEADING_COMMENTS = String.raw`^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*`;
const hasDirective = (src, name) => new RegExp(`${LEADING_COMMENTS}["']${name}["']`).test(src);
const isClientEntry = (src) => hasDirective(src, "use client");
/** "use server" modules (server actions) are RPC boundaries: the browser only gets a reference stub. */
const isServerActionModule = (src) => hasDirective(src, "use server");

/** Runtime (non-type-only) import specifiers of a module. */
export function runtimeImports(src) {
  const specs = [];
  const fromRe = /(^|[\n;])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(fromRe)) {
    if (m[3]) continue; // import type / export type
    const clause = m[4].trim();
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces) {
      const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith("type "))) continue;
    }
    specs.push(m[5]);
  }
  for (const m of src.matchAll(/(^|[\n;])\s*import\s+["']([^"']+)["']/g)) specs.push(m[2]);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

function resolveLocal(spec, fromFile) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  return null;
}

function packageName(spec) {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function violationFor(spec, resolved) {
  if (resolved) {
    const r = rel(resolved);
    const dir = FORBIDDEN_DIRS.find((d) => r.startsWith(d));
    return dir ? `server-only folder ${dir}` : null;
  }
  const pkg = packageName(spec);
  if (pkg.startsWith("node:") || NODE_BUILTINS.has(pkg)) return "Node.js built-in";
  return FORBIDDEN_PACKAGES.get(pkg) ?? null;
}

const sourceCache = new Map();
const source = (f) => sourceCache.get(f) ?? sourceCache.set(f, readFileSync(f, "utf8")).get(f);

/** Every (client entry, forbidden target) pair, with one import chain each. */
export function findViolations() {
  const files = [...SCAN_DIRS.flatMap((d) => walk(path.join(root, d))), ...EXTRA_ENTRIES.map((f) => path.join(root, f)).filter(existsSync)];
  const entries = files.filter((f) => isClientEntry(source(f)));
  const violations = new Map();
  const reachable = new Set();
  for (const entry of entries) {
    const seen = new Set();
    const stack = [{ file: entry, chain: [rel(entry)] }];
    while (stack.length) {
      const { file, chain } = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      reachable.add(file);
      for (const spec of runtimeImports(source(file))) {
        const local = spec.startsWith(".") || spec.startsWith("@/");
        const resolved = local ? resolveLocal(spec, file) : null;
        const reason = violationFor(spec, resolved);
        const target = resolved ? rel(resolved) : packageName(spec);
        if (reason) {
          const key = `${rel(entry)}|${target}`;
          if (!violations.has(key)) violations.set(key, { target, reason, chain: [...chain, target] });
          continue;
        }
        if (resolved && /\.(ts|tsx|js|mjs)$/.test(resolved) && !isServerActionModule(source(resolved))) {
          stack.push({ file: resolved, chain: [...chain, rel(resolved)] });
        }
      }
    }
  }
  return { entries: entries.length, modules: reachable.size, violations: [...violations.values()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { entries, modules, violations } = findViolations();
  if (!violations.length) {
    console.log(`check-client-imports: OK (${entries} client entries, ${modules} modules reachable from the browser)`);
  } else {
    console.error(`check-client-imports: ${violations.length} server-only import(s) reachable from client code:\n`);
    for (const v of violations) console.error(`  ✗ ${v.target} (${v.reason})\n    ${v.chain.join("\n      → ")}\n`);
    process.exit(1);
  }
}
