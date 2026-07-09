#!/usr/bin/env bash
set -euo pipefail

# finalize-standalone-deploy.sh — make a `pnpm deploy` output (or an installed
# global paperclipai tree) actually bootable. (TON-2276)
#
# `pnpm deploy` copies DEV package.json files (exports -> ./src/*.ts) and skips
# the npm publish lifecycle, so the artifact crash-loops and serves API-only.
# This script reproduces npm's pack-time behavior deterministically:
#   1. overlay each @paperclipai/* publishConfig onto its manifest root
#   2. ensure @paperclipai/server ships a populated ui-dist
#   3. verify the result is bootable (fails loudly if not)
#
# Idempotent: safe to re-run. Use this instead of hand-patching node_modules.
#
# Usage:
#   scripts/finalize-standalone-deploy.sh <targetDir>
#
#   <targetDir> = a `pnpm deploy` output dir, or a global install root
#                 (e.g. .../lib/node_modules/paperclipai)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: finalize-standalone-deploy.sh <targetDir>}"
TARGET="$(cd "$TARGET" && pwd)"

echo "==> finalize-standalone-deploy: $TARGET"

# ── Step 1: overlay publishConfig (exports/main/types) onto manifest roots ──────
echo "  [1/3] Applying publishConfig overlays..."
node "$REPO_ROOT/scripts/apply-publish-config.mjs" "$TARGET"

# ── Step 2: ensure @paperclipai/server ui-dist is populated ─────────────────────
echo "  [2/3] Ensuring server ui-dist..."
# Resolve the server dir robustly via node (handles nested node_modules layouts).
SERVER_DIR="$(node --input-type=module -e '
  import { findScopedPackageDirs } from "'"$REPO_ROOT"'/scripts/apply-publish-config.mjs";
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  const dirs = findScopedPackageDirs(process.argv[1]);
  for (const d of dirs) {
    try {
      const p = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
      if (p.name === "@paperclipai/server") { console.log(d); break; }
    } catch {}
  }
' "$TARGET")"

if [ -z "$SERVER_DIR" ]; then
  echo "ERROR: @paperclipai/server not found under $TARGET" >&2
  exit 1
fi

if [ -f "$SERVER_DIR/ui-dist/index.html" ]; then
  echo "    ui-dist already present ($SERVER_DIR/ui-dist)"
else
  echo "    ui-dist missing — building UI and copying in..."
  bash "$REPO_ROOT/scripts/prepare-server-ui-dist.sh"
  rm -rf "$SERVER_DIR/ui-dist"
  mkdir -p "$SERVER_DIR/ui-dist"
  cp -R "$REPO_ROOT/server/ui-dist/." "$SERVER_DIR/ui-dist/"
  echo "    ui-dist copied ($(ls "$SERVER_DIR/ui-dist" | wc -l | tr -d ' ') entries)"
fi

# ── Step 3: durable Hermes session-id guard (TON-2274/2287/2983) ────────────────
# The fork-channel release loads the UPSTREAM published
# @paperclipai/hermes-paperclip-adapter, which lacks our session-id --resume
# guard; a fresh `pnpm deploy` wipes any hand-hotfix. Re-apply it here so every
# release carries it. Idempotent (no-op if already present / adapter absent);
# fails loudly if upstream drifted so we re-check whether the fix went upstream.
echo "  [3/4] Applying Hermes session-id guard..."
node "$REPO_ROOT/scripts/patch-hermes-session-id.mjs" "$TARGET"

# ── Step 4: verify bootability ──────────────────────────────────────────────────
echo "  [4/4] Verifying bootability..."
node "$REPO_ROOT/scripts/verify-standalone-deploy.mjs" "$TARGET"

echo "==> finalize-standalone-deploy: done (bootable)"
