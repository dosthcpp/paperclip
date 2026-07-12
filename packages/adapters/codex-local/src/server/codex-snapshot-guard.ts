import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

/**
 * TON-3109 — keep live credentials out of Codex's shell snapshots.
 *
 * Codex (`codex_core::shell_snapshot`, vendored into @zed-industries/codex-acp)
 * writes `$CODEX_HOME/shell_snapshots/<uuid>.<ns>.sh` on every run. The snapshot
 * shell sources the user's zsh rc (`$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`) and
 * then dumps `export -p` verbatim into that file. Three independent paths put
 * live secrets in there:
 *
 *   1. the inherited process env (the Paperclip server itself is started from a
 *      login shell whose rc exports credentials),
 *   2. `~/.zshrc` re-exporting credentials inside the snapshot shell, and
 *   3. `[shell_environment_policy].set` in config.toml, which TON-2414 used to
 *      hand secrets to shell tools — `set` is applied *after* Codex's own
 *      name-based excludes, so it defeated them.
 *
 * Every agent in a company runs as the same unix user, so file modes cannot
 * isolate these files from each other: any agent can read any other agent's
 * snapshot. Redaction at write time is the only real control, so the filter here
 * is keyed on the *shape of the value*, not on a hardcoded list of variable
 * names — a new secret with an unseen name is still caught.
 */

export const SHELL_SNAPSHOT_DIR = "shell_snapshots";

/**
 * TON-3113 — the same credentials, by a second and independent path.
 *
 * Codex also appends every turn to `$CODEX_HOME/sessions/<y>/<m>/<d>/rollout-*.jsonl`,
 * and a shell tool's stdout is recorded there verbatim. An agent that runs `env`
 * or `printenv` — which they do, to discover `PAPERCLIP_*` — therefore freezes
 * every credential in its environment into a transcript that, like the snapshots,
 * every other agent on this unix user can read.
 *
 * This is *not* the snapshot vector: different directory, different writer, and
 * TON-2411/2476's snapshot scans never looked here. The ZDOTDIR guard below does
 * close it at the source (a shell that cannot see the secret cannot print it), so
 * this module's transcript half is defence in depth plus the cleanup of history
 * written before that guard shipped.
 */
export const SESSIONS_DIR = "sessions";

/**
 * Names whose values are intentionally allowed to reach a shell snapshot.
 *
 * `PAPERCLIP_API_KEY` is a per-run JWT that expires in an hour and is reissued
 * every run; shell tools need it to reach the Paperclip API (TON-3022). It is
 * an allowlist of one on purpose — the redaction itself stays value-shaped.
 */
export const SNAPSHOT_ALLOWED_SECRET_NAMES: ReadonlySet<string> = new Set([
  "PAPERCLIP_API_KEY",
]);

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // Vendor-prefixed API keys: sk-ant-…, sk-proj-…, sk-svcacct-…, sk-…, and the
  // github/slack/stripe/google families that share the prefix-then-entropy shape.
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  // JWTs (header.payload.signature, base64url).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  // Bare high-entropy hex signing secrets (BETTER_AUTH_SECRET is 64 hex chars).
  /^[0-9a-f]{32,}$/i,
  // Long base64/base64url blobs with no structure — the generic credential shape.
  /^[A-Za-z0-9+/_-]{40,}={0,2}$/,
];

/**
 * True when `value` looks like a credential regardless of what it is called.
 *
 * Deliberately shape-based: a value that carries this much unstructured entropy
 * has no business being frozen into a world-readable snapshot even if we have
 * never seen its variable name before.
 */
export function looksLikeSecretValue(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length < 20) return false;
  // Paths, URLs and sentences are long but structured; they are not secrets.
  if (/^(?:\/|~|\.{1,2}\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(candidate)) return false;
  if (/\s/.test(candidate)) return false;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(candidate));
}

/** True when this env entry must not be allowed to reach a shell snapshot. */
export function isRedactableEnvEntry(name: string, value: string): boolean {
  if (SNAPSHOT_ALLOWED_SECRET_NAMES.has(name)) return false;
  return looksLikeSecretValue(value);
}

/**
 * Report the secret-shaped entries of an env map without ever returning a value.
 * Used for run logs and for the regression check's failure output.
 */
export function redactableEnvNames(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => isRedactableEnvEntry(name, value))
    .map(([name]) => name)
    .sort();
}

const SET_ENTRY_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
const SET_TABLE_RE = /(^[ \t]*set\s*=\s*\{)([^}]*)(\})/m;
const EXCLUDE_LINE_RE = /^[ \t]*exclude\s*=\s*\[[^\]]*\]\s*$/m;
const POLICY_HEADER_RE = /^[ \t]*\[shell_environment_policy\][ \t]*$/m;

/**
 * Stop Codex handing credential-shaped variables to its shell tools.
 *
 * This — not any rc file — is the control that actually reaches a shell tool.
 * Codex runs tool commands in a *non-interactive* login shell (`/bin/zsh -lc`),
 * and a non-interactive zsh reads `~/.zshenv` but **never `~/.zshrc`**. So an
 * unset loop placed in a `.zshrc` (whether the user's own or a managed ZDOTDIR
 * one) cannot touch the environment a shell tool sees: the credentials are there
 * because Codex inherits them from the server process and passes them straight
 * down. `[shell_environment_policy].exclude` is applied to that inherited env, so
 * it is the only lever that removes them before a tool can print one.
 *
 * The names are derived at call time from the *shape of the value*
 * (`redactableEnvNames`), not from a hardcoded list, so a credential whose name we
 * have never seen is still excluded. Codex's own process keeps `OPENAI_API_KEY` —
 * it needs it to reach the model API; only the shell tools lose it.
 * `PAPERCLIP_API_KEY` stays inherited: shell tools need it for the Paperclip API
 * (TON-3022), and it is a per-run JWT that expires in an hour.
 *
 * Returns the names it excluded (never the values).
 */
export async function enforceShellEnvironmentPolicyExcludes(
  codexHome: string,
  env: Record<string, string | undefined>,
  onLog?: AdapterExecutionContext["onLog"],
): Promise<string[]> {
  const names = redactableEnvNames(
    Object.fromEntries(
      Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
  );
  if (names.length === 0) return [];

  const configPath = path.join(codexHome, "config.toml");
  let contents: string;
  try {
    contents = await fs.readFile(configPath, "utf8");
  } catch {
    contents = "";
  }

  const excludeLine = `exclude = [${names.map((n) => `"${n}"`).join(", ")}]`;
  let next: string;
  if (EXCLUDE_LINE_RE.test(contents)) {
    next = contents.replace(EXCLUDE_LINE_RE, excludeLine);
  } else if (POLICY_HEADER_RE.test(contents)) {
    next = contents.replace(POLICY_HEADER_RE, (header) => `${header}\n${excludeLine}`);
  } else {
    next = `${contents.trimEnd()}\n\n[shell_environment_policy]\n${excludeLine}\n`;
  }
  if (next === contents) return names;

  await fs.writeFile(configPath, next, { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});
  if (onLog) {
    await onLog(
      "stdout",
      `[paperclip] Excluded ${names.length} credential-shaped variable(s) (${names.join(", ")}) ` +
        "from Codex's shell-tool environment (TON-3113).\n",
    );
  }
  return names;
}

/**
 * Remove every secret-shaped entry from `[shell_environment_policy].set` in
 * config.toml, leaving the rest of the file byte-identical.
 *
 * `set` entries override Codex's inherited env for shell tools, so anything left
 * here is guaranteed to land in the next snapshot. Rewriting only the inline
 * table keeps a hand-authored config intact. Idempotent.
 *
 * Returns the names it removed (never the values).
 */
export async function stripSecretsFromShellEnvironmentPolicy(
  codexHome: string,
  onLog?: AdapterExecutionContext["onLog"],
): Promise<string[]> {
  const configPath = path.join(codexHome, "config.toml");
  let contents: string;
  try {
    contents = await fs.readFile(configPath, "utf8");
  } catch {
    return [];
  }

  const table = SET_TABLE_RE.exec(contents);
  if (!table) return [];

  const removed: string[] = [];
  const kept: string[] = [];
  for (const entry of table[2].matchAll(SET_ENTRY_RE)) {
    const [, name, value] = entry;
    if (isRedactableEnvEntry(name, value)) removed.push(name);
    else kept.push(`${name} = "${value}"`);
  }
  if (removed.length === 0) return [];

  // Drop the whole `set = { … }` line when nothing survives, so we do not leave
  // an empty table behind for the next reader to puzzle over.
  const replacement = kept.length > 0 ? `${table[1]} ${kept.join(", ")} ${table[3]}` : "";
  const next = contents.replace(SET_TABLE_RE, replacement).replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(configPath, next, { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});

  if (onLog) {
    await onLog(
      "stdout",
      `[paperclip] Removed ${removed.length} credential-shaped entr${removed.length === 1 ? "y" : "ies"} ` +
        `(${removed.join(", ")}) from "${configPath}" so they cannot reach shell_snapshots (TON-3109).\n`,
    );
  }
  return removed;
}

/**
 * Delete every existing shell snapshot and lock the directory down.
 *
 * Called before and after each run: Codex rewrites the snapshot it needs at
 * session start, so purging is safe for in-flight work and bounds the exposure
 * of anything a future Codex build decides to dump there.
 */
export async function purgeShellSnapshots(codexHome: string): Promise<number> {
  const dir = path.join(codexHome, SHELL_SNAPSHOT_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let purged = 0;
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
    purged += 1;
  }
  // Codex creates this 0755; every agent shares the unix user anyway, but a lax
  // mode also exposes the files to anything else running on the box.
  await fs.chmod(dir, 0o700).catch(() => {});
  return purged;
}

export type SnapshotSecretFinding = {
  file: string;
  line: number;
  name: string;
};

/**
 * Scan `$CODEX_HOME/shell_snapshots/**` for exported credential-shaped values.
 *
 * This is the regression check behind TON-3109's acceptance criterion: after a
 * real run, this must return zero findings. It reports names and locations only
 * — it never echoes a secret value.
 */
export async function scanShellSnapshotsForSecrets(
  codexHome: string,
): Promise<SnapshotSecretFinding[]> {
  const dir = path.join(codexHome, SHELL_SNAPSHOT_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const findings: SnapshotSecretFinding[] = [];
  const exportLine = /^(?:export|declare -x|typeset -x)\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
  for (const entry of entries) {
    const file = path.join(dir, entry);
    let contents: string;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    contents.split("\n").forEach((line, index) => {
      const match = exportLine.exec(line.trim());
      if (!match) return;
      const [, name, rawValue] = match;
      const value = rawValue.replace(/^'(.*)'$/s, "$1").replace(/^"(.*)"$/s, "$1");
      if (isRedactableEnvEntry(name, value)) {
        findings.push({ file, line: index + 1, name });
      }
    });
  }
  return findings;
}

/**
 * The credential shapes we redact from a session transcript.
 *
 * Deliberately a *subset* of SECRET_VALUE_PATTERNS: a transcript is free text, so
 * the two shapeless patterns there (bare hex, bare base64) can only be applied to
 * a whole value that we already know is a value. Unanchored against prose they
 * would match git SHAs, base64 payloads and ordinary identifiers, and a
 * false positive here silently rewrites an agent's history. Every pattern below
 * carries a vendor prefix or JWT structure, so it cannot fire on prose.
 *
 * Unlike the snapshot path, `PAPERCLIP_API_KEY` is *not* exempt here. The snapshot
 * exemption exists because shell tools need that variable to reach the Paperclip
 * API (TON-3022); a transcript is a recording, nothing reads a credential back out
 * of it, so there is no reason to keep one.
 */
const TRANSCRIPT_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** Placeholder left in a transcript in place of a credential. */
export const TRANSCRIPT_REDACTION = "[REDACTED:TON-3113]";

/**
 * Replace every credential-shaped run of characters in `text`.
 *
 * The placeholder contains no JSON metacharacters, so substituting it inside a
 * JSONL line leaves the line valid JSON and the file's line count unchanged —
 * which is what keeps `codex resume` working on a redacted transcript.
 */
export function redactSecretsInText(text: string): { text: string; count: number } {
  let count = 0;
  let next = text;
  for (const pattern of TRANSCRIPT_SECRET_PATTERNS) {
    next = next.replace(pattern, () => {
      count += 1;
      return TRANSCRIPT_REDACTION;
    });
  }
  return { text: next, count };
}

async function listRolloutFiles(codexHome: string): Promise<string[]> {
  const root = path.join(codexHome, SESSIONS_DIR);
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  await walk(root);
  return files;
}

/**
 * Scan `$CODEX_HOME/sessions/**` for credential-shaped values.
 *
 * The regression gate for TON-3113: after a real run this must return zero.
 * Reports locations only — never a value.
 */
export async function scanSessionRolloutsForSecrets(
  codexHome: string,
): Promise<SnapshotSecretFinding[]> {
  const findings: SnapshotSecretFinding[] = [];
  for (const file of await listRolloutFiles(codexHome)) {
    let contents: string;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    contents.split("\n").forEach((line, index) => {
      if (redactSecretsInText(line).count > 0) {
        // A transcript line is a JSON blob, not `NAME=value`, so there is no
        // variable name to report — the location is the actionable part.
        findings.push({ file, line: index + 1, name: "transcript" });
      }
    });
  }
  return findings;
}

/**
 * Redact credentials from session transcripts in place.
 *
 * Deletion is the obvious alternative and is the wrong call: Codex reads these
 * files back for `resume`, so removing one destroys the history of a session that
 * may still be in flight. Redaction keeps the transcript loadable — same line
 * count, same JSON — while removing the value.
 *
 * `minAgeMs` skips transcripts Codex may still hold an open append handle on.
 * Rewriting is atomic (temp + rename), which would strand such a handle on the
 * old inode and lose that session's subsequent turns; an in-flight transcript is
 * left for the next run, by which time it is closed and old enough to touch.
 *
 * Returns the number of files changed (never a value).
 */
export async function redactSessionRollouts(
  codexHome: string,
  options: { minAgeMs?: number; now?: number } = {},
): Promise<{ filesRedacted: number; secretsRedacted: number; skippedInFlight: number }> {
  const minAgeMs = options.minAgeMs ?? 15 * 60 * 1000;
  const now = options.now ?? Date.now();
  let filesRedacted = 0;
  let secretsRedacted = 0;
  let skippedInFlight = 0;

  for (const file of await listRolloutFiles(codexHome)) {
    let contents: string;
    let mtimeMs: number;
    try {
      const stat = await fs.stat(file);
      mtimeMs = stat.mtimeMs;
      contents = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const { text, count } = redactSecretsInText(contents);
    if (count === 0) continue;
    // `minAgeMs: 0` disables the check outright. Testing `now - mtimeMs` against it
    // would not: a file written moments ago can carry an mtime a fraction of a
    // millisecond *ahead* of `Date.now()`, making its apparent age negative and
    // sweeping it into the in-flight bucket that zero was meant to empty.
    if (minAgeMs > 0 && now - mtimeMs < minAgeMs) {
      skippedInFlight += 1;
      continue;
    }
    const tmp = `${file}.ton3113.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
    filesRedacted += 1;
    secretsRedacted += count;
  }
  return { filesRedacted, secretsRedacted, skippedInFlight };
}

/**
 * The rc that Codex's snapshot shell sources, in place of the user's own.
 *
 * We still source the user's rc — agents need the PATH, nvm shims and functions
 * it sets up — and then drop credential-shaped exports before Codex reaches its
 * `export -p`. Doing it here (rather than by scrubbing the process env) means
 * Codex itself keeps the credentials it needs to talk to the model API, while
 * the shell it snapshots does not.
 */
function snapshotSafeZshrc(): string {
  return `# Managed by Paperclip (codex-local adapter) — TON-3109. Do not edit.
# Codex's shell_snapshot sources this file and then dumps 'export -p' into
# $CODEX_HOME/shell_snapshots/*.sh. Source the user's real rc first, so agent
# shells keep the PATH, nvm shims and functions they need, then unexport every
# credential-shaped value before Codex can freeze it into the snapshot.
if [ -r "\${HOME}/.zshrc" ]; then
  . "\${HOME}/.zshrc"
fi

# Redaction keys off the SHAPE OF THE VALUE, never a list of variable names, so a
# credential whose name we have never seen is still dropped. PAPERCLIP_API_KEY is
# the one exemption: it is a per-run JWT that expires in an hour and shell tools
# need it to reach the Paperclip API (TON-3022).
for __pc_name in \${(k)parameters}; do
  [[ \${parameters[\$__pc_name]} == *export* ]] || continue
  [[ \$__pc_name == PAPERCLIP_API_KEY ]] && continue
  __pc_value=\${(P)__pc_name}
  case \$__pc_value in
    sk-*|gh[pousr]_*|github_pat_*|xox[abposr]-*|AKIA*|AIza*|eyJ*.*.*)
      unset \$__pc_name 2>/dev/null
      continue
      ;;
  esac
  # Bare high-entropy hex signing secrets (a 64-char BETTER_AUTH_SECRET, say)
  # carry no prefix to match on, so key off alphabet + length instead.
  if [[ \$__pc_value =~ '^[0-9a-fA-F]{32,}$' ]]; then
    unset \$__pc_name 2>/dev/null
  fi
done
unset __pc_name __pc_value
`;
}

/**
 * `.zshenv` is read from ZDOTDIR once ZDOTDIR is set, so the user's own
 * `~/.zshenv` would silently stop loading. Chain to it explicitly.
 */
function snapshotSafeZshenv(): string {
  return `# Managed by Paperclip (codex-local adapter) — TON-3109. Do not edit.
# zsh reads .zshenv from ZDOTDIR, so the user's ~/.zshenv would otherwise be
# skipped for every Codex shell. Keep it loading.
if [ -r "\${HOME}/.zshenv" ]; then
  . "\${HOME}/.zshenv"
fi
`;
}

/**
 * Write the snapshot-safe rc pair and return the ZDOTDIR to hand to Codex.
 */
export async function prepareSnapshotSafeZdotdir(codexHome: string): Promise<string> {
  const zdotdir = path.join(codexHome, "shell-rc");
  await fs.mkdir(zdotdir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(zdotdir, ".zshrc"), snapshotSafeZshrc(), { mode: 0o600 });
  await fs.writeFile(path.join(zdotdir, ".zshenv"), snapshotSafeZshenv(), { mode: 0o600 });
  return zdotdir;
}
