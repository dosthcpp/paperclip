#!/usr/bin/env node
/**
 * TON-3109 / TON-3113 regression check — fails if any Codex home leaks a live
 * credential, by either of the two known paths.
 *
 * Codex writes both of these, on every run, from the same environment:
 *
 *   shell_snapshots/<uuid>.<ns>.sh       a verbatim `export -p` dump      (TON-3109)
 *   sessions/<y>/<m>/<d>/rollout-*.jsonl a turn-by-turn transcript that
 *                                        includes shell-tool stdout verbatim, so
 *                                        an agent which runs `env` freezes its
 *                                        credentials into it              (TON-3113)
 *
 * Every agent in a company runs as the same unix user, so any agent can read any
 * other agent's copy of either file (TON-2373). The snapshot scans in TON-2411 and
 * TON-2476 only ever looked at the first path, which is how the transcripts went
 * unnoticed; this gate covers both, across every Codex home on the host — the
 * per-company ones *and* the per-agent ones the old gate walked past.
 *
 *   node packages/adapters/codex-local/scripts/check-codex-secrets.ts
 *   node .../check-codex-secrets.ts --home /path/to/codex-home
 *
 * Exits non-zero on a finding, and prints locations only — never a secret value.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// A `.ts` specifier (not the repo's usual `.js`) so this runs under plain
// `node --experimental-strip-types` with no extra tooling. `scripts/` sits
// outside this package's tsconfig `include`, so it is never compiled.
import {
  type SnapshotSecretFinding,
  scanSessionRolloutsForSecrets,
  scanShellSnapshotsForSecrets,
} from "../src/server/codex-snapshot-guard.ts";

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

/**
 * Every Codex home on this host: the user's own, plus the homes Paperclip seeds
 * under $PAPERCLIP_HOME/instances/<id>/ — per instance, per company, and per agent
 * (companies/<id>/agents/<id>/codex-home, which the TON-3109 gate did not walk).
 */
async function discoverCodexHomes(): Promise<string[]> {
  const explicit = process.argv.indexOf("--home");
  if (explicit !== -1 && process.argv[explicit + 1]) {
    return [path.resolve(process.argv[explicit + 1])];
  }

  const homes = new Set<string>([process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")]);
  const paperclipHome =
    process.env.PAPERCLIP_HOME ?? path.join(os.homedir(), ".paperclip-runtime");
  for (const instance of await listDirs(path.join(paperclipHome, "instances"))) {
    homes.add(path.join(instance, "codex-home"));
    for (const company of await listDirs(path.join(instance, "companies"))) {
      homes.add(path.join(company, "codex-home"));
      for (const agent of await listDirs(path.join(company, "agents"))) {
        homes.add(path.join(agent, "codex-home"));
      }
    }
  }
  return [...homes];
}

const homes = await discoverCodexHomes();
const snapshotFindings: SnapshotSecretFinding[] = [];
const transcriptFindings: SnapshotSecretFinding[] = [];
for (const home of homes) {
  snapshotFindings.push(...(await scanShellSnapshotsForSecrets(home)));
  transcriptFindings.push(...(await scanSessionRolloutsForSecrets(home)));
}

if (snapshotFindings.length === 0 && transcriptFindings.length === 0) {
  console.log(
    `✓ TON-3109/TON-3113: 0 credential-shaped values across ${homes.length} Codex home(s) ` +
      "(shell_snapshots/** and sessions/**).",
  );
  process.exit(0);
}

console.error(
  `✗ ${snapshotFindings.length} credential-shaped export(s) in shell_snapshots/** (TON-3109) and ` +
    `${transcriptFindings.length} credential-shaped line(s) in sessions/** (TON-3113).\n` +
    "  These are readable by every agent running as this unix user (TON-2373 vector).\n",
);
for (const finding of snapshotFindings) {
  console.error(`  [snapshot]   ${finding.file}:${finding.line}  ${finding.name}`);
}
// A leaking transcript usually leaks on many lines; the file is the unit of action,
// so collapse to one line per file and keep the output readable.
const byFile = new Map<string, number>();
for (const finding of transcriptFindings) {
  byFile.set(finding.file, (byFile.get(finding.file) ?? 0) + 1);
}
for (const [file, count] of byFile) {
  console.error(`  [transcript] ${file}  (${count} line(s))`);
}
console.error(
  "\n  Snapshots: purge them. Transcripts: redact in place (redactSessionRollouts) —\n" +
    "  do not delete them, `codex resume` reads them back. Then confirm the codex-local\n" +
    "  adapter's guard is actually running: a shell that cannot see a secret cannot print\n" +
    "  one, and that is what stops new ones being written.",
);
process.exit(1);
