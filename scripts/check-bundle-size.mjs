// Client bundle budget. Run after `next build`.
//
//   node scripts/check-bundle-size.mjs           compare .next against perf/bundle-baseline.json (exit 1 on failure)
//   node scripts/check-bundle-size.mjs --write   record the current build as the new baseline
//
// Chunk file names are content hashes, so each chunk gets a stable key instead:
//   - Next's runtime chunks (build-manifest rootMainFiles): "next-runtime[i]"
//   - app chunks: the client modules they serve (from the client reference manifests), else the route
//     segments that load them. Chunks with the same key are always loaded together and are budgeted as
//     one group.
// Fails when any chunk, any route's first-load JS, or the remaining async JS grows more than 20% (gzip),
// or when a server-only library shows up in a client chunk. New chunks are reported, not failed; the
// per-route totals still cover them.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const next = path.join(root, ".next");
const baselineFile = path.join(root, "perf", "bundle-baseline.json");
export const MAX_GROWTH = 0.2;
/** Strings that only appear in the browser build if a server-side library leaked into it. */
const FORBIDDEN_MARKERS = [
  ["zod", "ZodError"],
  ["@prisma/client", "PrismaClient"],
  ["jose", "JWSSignatureVerificationFailed"],
  ["firebase-admin", "firebase-admin"],
  ["web-push", "generateVAPIDKeys"],
];

const gz = (file) => gzipSync(readFileSync(path.join(next, file)), { level: 9 }).length;
const short = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}

/** "/(site)/scrims/(list)/page" → "/scrims" */
export function routeOf(manifestKey) {
  const r = manifestKey.replace(/\/page$/, "").replace(/\/\([^/)]+\)/g, "");
  return r === "" ? "/" : r;
}

function loadManifests() {
  const files = walk(path.join(next, "server", "app"), (n) => n === "page_client-reference-manifest.js");
  return files.map((f) => {
    const sandbox = {};
    new Function("globalThis", "self", readFileSync(f, "utf8"))(sandbox, sandbox);
    const [key, manifest] = Object.entries(sandbox.__RSC_MANIFEST)[0];
    return { route: routeOf(key), manifest };
  });
}

const norm = (chunk) => chunk.replace(/^\/?_next\//, "").replace(/^\//, "");
const project = (id) => id.replace(/^\[project\]\//, "");

/** Measures the current build: per-chunk (stable keys), per-route first-load JS, and the rest. */
export function measure() {
  if (!existsSync(path.join(next, "build-manifest.json"))) throw new Error("No .next build found: run `npm run build` first.");
  const buildManifest = JSON.parse(readFileSync(path.join(next, "build-manifest.json"), "utf8"));
  const runtime = buildManifest.rootMainFiles.map(norm);
  const polyfills = new Set(buildManifest.polyfillFiles.map(norm));
  const manifests = loadManifests();

  const modulesByChunk = new Map();
  const entriesByChunk = new Map();
  const add = (map, chunk, v) => map.set(chunk, (map.get(chunk) ?? new Set()).add(v));
  const routes = {};
  for (const { route, manifest } of manifests) {
    for (const [id, m] of Object.entries(manifest.clientModules)) {
      for (const c of m.chunks) add(modulesByChunk, norm(c), project(id));
    }
    const firstLoad = new Set(runtime);
    for (const [entry, chunks] of Object.entries(manifest.entryJSFiles)) {
      for (const c of chunks) {
        add(entriesByChunk, norm(c), project(entry));
        firstLoad.add(norm(c));
      }
    }
    routes[route] = [...firstLoad].reduce((sum, c) => sum + gz(c), 0);
  }

  const chunks = {};
  const keyed = new Set();
  runtime.forEach((c, i) => {
    chunks[`next-runtime[${i}]`] = { label: "Next.js / React runtime", gzip: gz(c), files: [c] };
    keyed.add(c);
  });
  // Chunks that serve exactly the same client modules (or, without modules, the same route segments) are
  // always loaded together, so they form one budget group: pairing individual files inside such a group
  // is not stable across builds, the group's total is.
  for (const c of new Set([...modulesByChunk.keys(), ...entriesByChunk.keys()])) {
    if (keyed.has(c) || polyfills.has(c) || !existsSync(path.join(next, c))) continue;
    const mods = [...(modulesByChunk.get(c) ?? [])].filter((m) => !m.startsWith("node_modules/")).sort();
    const entries = [...(entriesByChunk.get(c) ?? [])].sort();
    const basis = mods.length ? `modules:${mods.join(",")}` : `entries:${entries.join(",")}`;
    const key = `${mods.length ? "app" : "shared"}:${short(basis)}`;
    const label = mods.length ? `${mods.slice(0, 2).join(", ")}${mods.length > 2 ? ` +${mods.length - 2}` : ""}` : `shared by ${entries.slice(0, 2).join(", ")}`;
    const group = chunks[key] ?? (chunks[key] = { label, gzip: 0, files: [] });
    group.gzip += gz(c);
    group.files.push(c);
    keyed.add(c);
  }
  for (const g of Object.values(chunks)) if (g.files && g.files.length > 1) g.label += ` (${g.files.length} files)`;

  const allJs = walk(path.join(next, "static", "chunks"), (n) => n.endsWith(".js")).map((f) => path.relative(next, f).split(path.sep).join("/"));
  const other = allJs.filter((c) => !keyed.has(c) && !polyfills.has(c)).reduce((sum, c) => sum + gz(c), 0);

  const leaks = [];
  for (const c of allJs) {
    if (polyfills.has(c)) continue;
    const src = readFileSync(path.join(next, c), "utf8");
    for (const [lib, marker] of FORBIDDEN_MARKERS) if (src.includes(marker)) leaks.push(`${lib} in ${c}`);
  }
  return { next: JSON.parse(readFileSync(path.join(root, "node_modules/next/package.json"), "utf8")).version, chunks, routes, other, leaks };
}

/** Compare a measurement to a baseline; returns human-readable failures and notes. */
export function compare(current, baseline, maxGrowth = MAX_GROWTH) {
  const failures = [];
  const notes = [];
  const check = (what, now, before) => {
    if (before === undefined) return notes.push(`new: ${what} ${kb(now)}`);
    if (now > before * (1 + maxGrowth)) failures.push(`${what}: ${kb(before)} → ${kb(now)} (+${Math.round((now / before - 1) * 100)}%, limit +${maxGrowth * 100}%)`);
  };
  for (const [key, c] of Object.entries(current.chunks)) check(`chunk ${key} (${c.label})`, c.gzip, baseline.chunks[key]?.gzip);
  for (const [route, size] of Object.entries(current.routes)) check(`route ${route} first-load JS`, size, baseline.routes[route]);
  check("async / other JS", current.other, baseline.other);
  for (const leak of current.leaks) failures.push(`server-only library in the browser bundle: ${leak}`);
  if (baseline.next && baseline.next !== current.next) notes.push(`Next.js ${baseline.next} → ${current.next}: runtime chunks may shift; re-baseline if intended.`);
  return { failures, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const current = measure();
  if (process.argv.includes("--write")) {
    if (current.leaks.length) {
      console.error(`Refusing to write a baseline with server-only code in the bundle:\n  ${current.leaks.join("\n  ")}`);
      process.exit(1);
    }
    mkdirSync(path.dirname(baselineFile), { recursive: true });
    // Baseline keeps sizes only: no leak list, no hashed file names (they change every build).
    const stable = {
      next: current.next,
      chunks: Object.fromEntries(Object.entries(current.chunks).map(([k, v]) => [k, { label: v.label, gzip: v.gzip }])),
      routes: current.routes,
      other: current.other,
    };
    writeFileSync(baselineFile, `${JSON.stringify(stable, null, 2)}\n`);
    console.log(`bundle baseline written: ${Object.keys(stable.chunks).length} chunks, ${Object.keys(stable.routes).length} routes → ${path.relative(root, baselineFile)}`);
  } else {
    if (!existsSync(baselineFile)) {
      console.error("No perf/bundle-baseline.json. Create it with: npm run bundle:baseline");
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
    const { failures, notes } = compare(current, baseline);
    const worst = Object.entries(current.routes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`bundle size: ${Object.keys(current.chunks).length} chunks, ${Object.keys(current.routes).length} routes; largest first-load JS: ${worst.map(([r, s]) => `${r} ${kb(s)}`).join(", ")}`);
    for (const n of notes) console.log(`  · ${n}`);
    if (failures.length) {
      console.error(`\nbundle size check FAILED:\n  ✗ ${failures.join("\n  ✗ ")}\n\nIf the growth is intended, update the baseline in the same PR: npm run build && npm run bundle:baseline`);
      process.exit(1);
    }
    console.log("bundle size check: OK");
  }
}
