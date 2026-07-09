#!/usr/bin/env node
// patch-hermes-session-id.mjs — durably re-apply the TON-2274/TON-2287
// Hermes session-id validation guard onto the *published*
// @paperclipai/hermes-paperclip-adapter dist inside a deployed tree.
//
// WHY THIS EXISTS (TON-2983 durability):
//   The live fix (commit a1e0a9d1b on branch ton-2230-hermes-local-adapter)
//   lives in the *in-tree* adapter `packages/adapters/hermes-local`, but the
//   fork-channel release actually loads the UPSTREAM published package
//   `@paperclipai/hermes-paperclip-adapter` (pulled fresh by `pnpm deploy`).
//   So the in-tree merge never reaches the runtime. On 2026-07-09 the fix was
//   hand-hotfixed into the deployed dist (execute.js.bak-TON2287-20260709), but
//   a bare hotfix is wiped by the next `pnpm i` / upgrade. This script makes the
//   patch a first-class, idempotent build step so every release carries it.
//
// CONTRACT:
//   - Idempotent: if the guard is already present, it is a no-op (exit 0).
//   - Loud on drift: if the adapter is present but an anchor no longer matches
//     (upstream changed the code / bumped the version), it EXITS NON-ZERO so the
//     build fails and a human re-evaluates whether upstream absorbed the fix
//     (mirrors the README "check each fix against upstream on upgrade" rule).
//   - No-op (exit 0) when the adapter is absent from the tree.
//
// Usage: node scripts/patch-hermes-session-id.mjs <deployedTreeRoot>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: patch-hermes-session-id.mjs <deployedTreeRoot>");
  process.exit(2);
}

const ADAPTER = "@paperclipai/hermes-paperclip-adapter";
const GUARD_FN = "function isValidHermesSessionId";

const HELPER_BLOCK = `// Session id validation (TON-2274 / TON-2287)
// ---------------------------------------------------------------------------
/**
 * Valid Hermes session id shapes: CLI \`YYYYMMDD_HHMMSS_<hex>\` (e.g.
 * \`20260607_235905_41c7c7\`) or ACP UUID. Anything else must NEVER reach
 * \`hermes chat --resume\`: Hermes aborts with "Session not found" and returns
 * False (no fresh-session fallback), which fails the Paperclip run and
 * reassigns the issue. Guards two field culprits: a stray word like \`from\`
 * captured by the loose legacy regex out of "session saved from <path>", and a
 * Paperclip-side id like \`20260607_235905_\` (no hex suffix) never valid here.
 */
const HERMES_SESSION_ID_REGEX = /^(?:\\d{8}_\\d{6}_[0-9a-f]{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function isValidHermesSessionId(id) {
    return typeof id === "string" && HERMES_SESSION_ID_REGEX.test(id.trim());
}`;

// Anchored, exact-string rewrites. Each anchor must appear exactly once.
const REWRITES = [
  {
    name: "helper-definition",
    // Insert the validator right after the COST_REGEX declaration, before first use.
    find: `const COST_REGEX = /(?:cost|spent)[:\\s]*\\$?([\\d.]+)/i;`,
    replace: `const COST_REGEX = /(?:cost|spent)[:\\s]*\\$?([\\d.]+)/i;\n${HELPER_BLOCK}`,
  },
  {
    name: "parse-quiet-site",
    find: `        result.sessionId = sessionMatch?.[1] ?? null;`,
    replace: `        result.sessionId = isValidHermesSessionId(sessionMatch[1]) ? sessionMatch[1] : null;`,
  },
  {
    name: "parse-legacy-site",
    find: `        if (legacyMatch?.[1]) {\n            result.sessionId = legacyMatch?.[1] ?? null;\n        }`,
    replace: `        if (legacyMatch?.[1] && isValidHermesSessionId(legacyMatch[1])) {\n            result.sessionId = legacyMatch[1];\n        }`,
  },
  {
    name: "resume-site",
    find: `    if (persistSession && prevSessionId) {`,
    replace: `    if (persistSession && isValidHermesSessionId(prevSessionId)) {`,
  },
];

// Robustly locate every @paperclipai/hermes-paperclip-adapter dir under root
// (handles flat/hoisted and nested node_modules layouts).
function findAdapterDirs(base) {
  const found = [];
  const stack = [base];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name === "node_modules") {
        // scope dirs live directly under node_modules
        const scope = join(full, "@paperclipai", "hermes-paperclip-adapter");
        if (existsSync(join(scope, "package.json"))) found.push(scope);
        // recurse into nested node_modules of every package
        try {
          for (const pkg of readdirSync(full, { withFileTypes: true })) {
            if (pkg.isDirectory()) stack.push(join(full, pkg.name));
          }
        } catch {}
      } else if (e.name.startsWith("@")) {
        stack.push(full);
      }
    }
  }
  return [...new Set(found)];
}

const adapterDirs = findAdapterDirs(root);
if (adapterDirs.length === 0) {
  console.log(`[patch-hermes-session-id] ${ADAPTER} not present under ${root} — nothing to do.`);
  process.exit(0);
}

let patchedCount = 0;
let alreadyCount = 0;

for (const adir of adapterDirs) {
  // The live resume path is dist/server/execute.js (the file that carried the
  // 2026-07-09 hotfix). Patch exactly that file.
  const target = join(adir, "dist", "server", "execute.js");
  if (!existsSync(target)) {
    console.error(`[patch-hermes-session-id] MISSING expected file: ${target}`);
    process.exit(1);
  }
  let src = readFileSync(target, "utf8");

  if (src.includes(GUARD_FN)) {
    console.log(`[patch-hermes-session-id] already patched: ${target}`);
    alreadyCount++;
    continue;
  }

  for (const rw of REWRITES) {
    const occurrences = src.split(rw.find).length - 1;
    if (occurrences !== 1) {
      console.error(
        `[patch-hermes-session-id] DRIFT: anchor "${rw.name}" matched ${occurrences}x (expected 1) in ${target}.`,
      );
      console.error(
        `  Upstream ${ADAPTER} likely changed. Re-evaluate whether the fix is now upstream (TON-2983 / README).`,
      );
      process.exit(1);
    }
    src = src.replace(rw.find, rw.replace);
  }

  if (!src.includes(GUARD_FN)) {
    console.error(`[patch-hermes-session-id] post-write verification failed: guard missing in ${target}`);
    process.exit(1);
  }
  writeFileSync(target, src);
  console.log(`[patch-hermes-session-id] PATCHED: ${target}`);
  patchedCount++;
}

console.log(
  `[patch-hermes-session-id] done — patched ${patchedCount}, already-present ${alreadyCount}, adapter dirs ${adapterDirs.length}.`,
);
