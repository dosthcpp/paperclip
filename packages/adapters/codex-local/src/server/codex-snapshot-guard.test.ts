import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRANSCRIPT_REDACTION,
  enforceShellEnvironmentPolicyExcludes,
  looksLikeSecretValue,
  prepareSnapshotSafeZdotdir,
  purgeShellSnapshots,
  redactSecretsInText,
  redactSessionRollouts,
  redactableEnvNames,
  scanSessionRolloutsForSecrets,
  scanShellSnapshotsForSecrets,
  stripSecretsFromShellEnvironmentPolicy,
} from "./codex-snapshot-guard.js";

const execFileAsync = promisify(execFile);

// Shapes only — none of these are live values.
const FAKE_ANTHROPIC_KEY = `sk-ant-api03-${"A1b2C3d4E5f6G7h8".repeat(4)}`;
const FAKE_HEX_SECRET = "9f".repeat(32); // 64 hex chars, BETTER_AUTH_SECRET shape
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJydW5faWQiOiJ0b24zMTA5In0.c2lnbmF0dXJlX3ZhbHVl";

describe("looksLikeSecretValue", () => {
  it("catches credential shapes regardless of variable name", () => {
    expect(looksLikeSecretValue(FAKE_ANTHROPIC_KEY)).toBe(true);
    expect(looksLikeSecretValue(FAKE_HEX_SECRET)).toBe(true);
    expect(looksLikeSecretValue(FAKE_JWT)).toBe(true);
    expect(looksLikeSecretValue(`ghp_${"x".repeat(36)}`)).toBe(true);
  });

  it("leaves ordinary long values alone", () => {
    expect(looksLikeSecretValue("/Users/tony/.paperclip/instances/default")).toBe(false);
    expect(looksLikeSecretValue("http://100.93.196.36:3101")).toBe(false);
    expect(looksLikeSecretValue("agent:main:slack:group:C0B0L91HLMU")).toBe(false);
    expect(looksLikeSecretValue("true")).toBe(false);
    expect(looksLikeSecretValue("a short one")).toBe(false);
  });
});

describe("redactableEnvNames", () => {
  it("reports secret-shaped names but exempts the per-run Paperclip JWT", () => {
    expect(
      redactableEnvNames({
        OPENAI_API_KEY: FAKE_ANTHROPIC_KEY,
        BETTER_AUTH_SECRET: FAKE_HEX_SECRET,
        PAPERCLIP_API_KEY: FAKE_JWT,
        PATH: "/usr/bin:/bin",
      }),
    ).toEqual(["BETTER_AUTH_SECRET", "OPENAI_API_KEY"]);
  });
});

describe("stripSecretsFromShellEnvironmentPolicy", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "ton3109-home-"));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("strips every credential-shaped entry and keeps the benign ones", async () => {
    const configPath = path.join(home, "config.toml");
    await fs.writeFile(
      configPath,
      [
        '[projects."/Users/tony"]',
        'trust_level = "trusted"',
        "",
        "[shell_environment_policy]",
        `set = { BETTER_AUTH_SECRET = "${FAKE_HEX_SECRET}", HERMES_REDACT_SECRETS = "true", OPENAI_API_KEY = "${FAKE_ANTHROPIC_KEY}" }`,
        "",
      ].join("\n"),
    );

    const removed = await stripSecretsFromShellEnvironmentPolicy(home);

    expect(removed).toEqual(["BETTER_AUTH_SECRET", "OPENAI_API_KEY"]);
    const out = await fs.readFile(configPath, "utf8");
    expect(out).not.toContain(FAKE_HEX_SECRET);
    expect(out).not.toContain(FAKE_ANTHROPIC_KEY);
    // benign entries and the rest of the file survive
    expect(out).toContain('set = { HERMES_REDACT_SECRETS = "true" }');
    expect(out).toContain('[projects."/Users/tony"]');
  });

  it("is idempotent and a no-op on a clean config", async () => {
    const configPath = path.join(home, "config.toml");
    await fs.writeFile(configPath, '[shell_environment_policy]\nset = { FOO = "bar" }\n');
    expect(await stripSecretsFromShellEnvironmentPolicy(home)).toEqual([]);
    expect(await fs.readFile(configPath, "utf8")).toContain('set = { FOO = "bar" }');
  });
});

describe("scanShellSnapshotsForSecrets / purgeShellSnapshots", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "ton3109-scan-"));
    await fs.mkdir(path.join(home, "shell_snapshots"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("flags exported secrets in a snapshot and purges them", async () => {
    await fs.writeFile(
      path.join(home, "shell_snapshots", "abc.123.sh"),
      [
        "# Snapshot file",
        "export PATH='/usr/bin:/bin'",
        `export OPENAI_API_KEY='${FAKE_ANTHROPIC_KEY}'`,
        `export PAPERCLIP_API_KEY='${FAKE_JWT}'`,
        "",
      ].join("\n"),
    );

    const findings = await scanShellSnapshotsForSecrets(home);
    expect(findings.map((f) => f.name)).toEqual(["OPENAI_API_KEY"]);

    expect(await purgeShellSnapshots(home)).toBe(1);
    expect(await scanShellSnapshotsForSecrets(home)).toEqual([]);
  });
});

describe("snapshot-safe ZDOTDIR (end-to-end against Codex's snapshot script)", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "ton3109-zdotdir-"));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  // Replays what codex_core::shell_snapshot actually runs: source the rc that
  // ZDOTDIR points at, then dump `export -p`. If a credential survives this, it
  // survives into $CODEX_HOME/shell_snapshots/*.sh.
  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "drops credential-shaped exports while keeping PATH and the run JWT",
    async () => {
      const zdotdir = await prepareSnapshotSafeZdotdir(home);

      const { stdout } = await execFileAsync(
        "zsh",
        [
          "-c",
          // `export -p` is the dump Codex freezes into the snapshot. PATH is a
          // tied special in zsh and is never listed there, so assert on it
          // separately to prove the rc did not break the agent's shell.
          'rc="$ZDOTDIR/.zshrc"; [[ -r $rc ]] && . "$rc"; export -p; print "PATH_LEN=${#PATH}"',
        ],
        {
          env: {
            ...process.env,
            ZDOTDIR: zdotdir,
            OPENAI_API_KEY: FAKE_ANTHROPIC_KEY,
            BETTER_AUTH_SECRET: FAKE_HEX_SECRET,
            SOME_UNKNOWN_FUTURE_TOKEN: `ghp_${"x".repeat(36)}`,
            PAPERCLIP_API_KEY: FAKE_JWT,
            PAPERCLIP_API_URL: "http://100.93.196.36:3101",
          },
          maxBuffer: 32 * 1024 * 1024,
        },
      );

      // No credential value survives, whatever it was called.
      expect(stdout).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(stdout).not.toContain(FAKE_HEX_SECRET);
      expect(stdout).not.toContain("ghp_xxxxxxxx");

      // The things agents actually need still do.
      expect(stdout).toContain(FAKE_JWT);
      expect(stdout).toContain("http://100.93.196.36:3101");
      expect(stdout).toMatch(/PATH_LEN=[1-9]\d*/);
    },
    30_000,
  );
});

/**
 * TON-3113 — the session transcript, the second path out of the same environment.
 * A shell tool's stdout is recorded verbatim, so `env` writes credentials here too.
 */
describe("session rollout transcripts (TON-3113)", () => {
  let home: string;

  // The exact shape Codex records: shell-tool stdout inside a JSON payload.
  const rolloutLine = (output: string) =>
    JSON.stringify({
      timestamp: "2026-05-03T01:19:25.029Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call_x", output },
    });

  async function writeRollout(name: string, lines: string[]): Promise<string> {
    const dir = path.join(home, "sessions", "2026", "05", "03");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(file, `${lines.join("\n")}\n`);
    return file;
  }

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "ton3113-sessions-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("finds credentials that a shell tool printed into a transcript", async () => {
    await writeRollout("rollout-2026-05-03T10-18-37-aaa.jsonl", [
      rolloutLine(`AGENT_ID=94dac770\nOPENAI_API_KEY=${FAKE_ANTHROPIC_KEY}\nUSER=tony`),
      rolloutLine("nothing to see here"),
    ]);

    const findings = await scanSessionRolloutsForSecrets(home);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
    // A finding must never carry the value it found.
    expect(JSON.stringify(findings)).not.toContain(FAKE_ANTHROPIC_KEY);
  });

  it("redacts the value while keeping the transcript replayable by `codex resume`", async () => {
    const file = await writeRollout("rollout-2026-05-03T10-18-37-bbb.jsonl", [
      rolloutLine(`OPENAI_API_KEY=${FAKE_ANTHROPIC_KEY}`),
      rolloutLine(`PAPERCLIP_API_KEY=${FAKE_JWT}`),
      rolloutLine("clean line"),
    ]);
    const before = await fs.readFile(file, "utf8");

    const result = await redactSessionRollouts(home, { minAgeMs: 0 });

    expect(result.filesRedacted).toBe(1);
    expect(result.secretsRedacted).toBe(2);

    const after = await fs.readFile(file, "utf8");
    expect(after).not.toContain(FAKE_ANTHROPIC_KEY);
    // Unlike the snapshot path, PAPERCLIP_API_KEY earns no exemption in a recording.
    expect(after).not.toContain(FAKE_JWT);
    expect(after).toContain(TRANSCRIPT_REDACTION);

    // Resume-safety: same line count, and every line still parses as JSON.
    const lines = after.trimEnd().split("\n");
    expect(lines).toHaveLength(before.trimEnd().split("\n").length);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(lines[0]).payload.type).toBe("function_call_output");
    expect(JSON.parse(lines[2]).payload.output).toBe("clean line");

    // Idempotent: a second pass finds nothing left to do.
    expect((await redactSessionRollouts(home, { minAgeMs: 0 })).filesRedacted).toBe(0);
    expect(await scanSessionRolloutsForSecrets(home)).toEqual([]);
  });

  it("leaves an in-flight transcript alone rather than stranding Codex's open handle", async () => {
    await writeRollout("rollout-2026-05-03T10-18-37-ccc.jsonl", [
      rolloutLine(`OPENAI_API_KEY=${FAKE_ANTHROPIC_KEY}`),
    ]);

    // Just written, so Codex may still be appending to it.
    const result = await redactSessionRollouts(home, { minAgeMs: 15 * 60 * 1000 });

    expect(result.filesRedacted).toBe(0);
    expect(result.skippedInFlight).toBe(1);
  });

  it("does not rewrite prose that merely looks long", () => {
    // A false positive here silently corrupts an agent's history, so the transcript
    // filter must not fire on git SHAs, paths or ordinary base64-ish identifiers.
    for (const benign of [
      "a3f5c9e1b7d2486af0c1e2d3b4a5968770123456", // 40-char git SHA
      "/Users/tony/.paperclip-runtime/instances/default/companies",
      "Q29kZXggcm9sbG91dCB0cmFuc2NyaXB0IHNhbXBsZSBwYXlsb2Fk", // plain base64
      "call_qoLqKRix3c8gJgGLSZnSo2LC",
    ]) {
      expect(redactSecretsInText(benign).count).toBe(0);
    }
  });

  it("catches an unseen variable name — the filter is value-shaped, not a name list", () => {
    const { text, count } = redactSecretsInText(`SOME_BRAND_NEW_VAR=${FAKE_ANTHROPIC_KEY}`);
    expect(count).toBe(1);
    expect(text).toBe(`SOME_BRAND_NEW_VAR=${TRANSCRIPT_REDACTION}`);
  });
});

/**
 * TON-3113 — the control that actually reaches a shell tool.
 *
 * Codex runs tool commands in a non-interactive login shell, which reads ~/.zshenv
 * but never ~/.zshrc, so no rc-based unset can touch their env. They see
 * credentials because Codex inherits them from the server process; `exclude` is
 * what removes them.
 */
describe("enforceShellEnvironmentPolicyExcludes (TON-3113)", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "ton3113-exclude-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  const env = {
    OPENAI_API_KEY: FAKE_ANTHROPIC_KEY,
    BETTER_AUTH_SECRET: FAKE_HEX_SECRET,
    SOME_UNKNOWN_FUTURE_VAR: `ghp_${"x".repeat(36)}`,
    PAPERCLIP_API_KEY: FAKE_JWT,
    PAPERCLIP_API_URL: "http://100.93.196.36:3101",
    PATH: "/usr/bin:/bin",
  };

  it("excludes every credential-shaped name, keeping what agents need", async () => {
    const configPath = path.join(home, "config.toml");
    await fs.writeFile(configPath, '[shell_environment_policy]\nset = { FOO = "bar" }\n');

    const excluded = await enforceShellEnvironmentPolicyExcludes(home, env);

    // Shape-keyed, so a name we have never seen is still caught...
    expect(excluded).toEqual(["BETTER_AUTH_SECRET", "OPENAI_API_KEY", "SOME_UNKNOWN_FUTURE_VAR"]);
    // ...while the per-run JWT shell tools need (TON-3022) stays inherited.
    expect(excluded).not.toContain("PAPERCLIP_API_KEY");
    expect(excluded).not.toContain("PATH");

    const out = await fs.readFile(configPath, "utf8");
    expect(out).toContain('exclude = ["BETTER_AUTH_SECRET", "OPENAI_API_KEY", "SOME_UNKNOWN_FUTURE_VAR"]');
    expect(out).toContain('set = { FOO = "bar" }');
    // The config is on disk and readable by every agent — it must never hold a value.
    expect(out).not.toContain(FAKE_ANTHROPIC_KEY);
    expect(out).not.toContain(FAKE_HEX_SECRET);
  });

  it("creates the policy section when config.toml has none", async () => {
    await fs.writeFile(path.join(home, "config.toml"), '[projects."/x"]\ntrust_level = "trusted"\n');

    await enforceShellEnvironmentPolicyExcludes(home, env);

    const out = await fs.readFile(path.join(home, "config.toml"), "utf8");
    expect(out).toContain("[shell_environment_policy]");
    expect(out).toContain("exclude = [");
    expect(out).toContain('[projects."/x"]');
  });

  it("is idempotent and refreshes a stale exclude list rather than appending", async () => {
    await fs.writeFile(
      path.join(home, "config.toml"),
      '[shell_environment_policy]\nexclude = ["STALE_NAME"]\n',
    );

    await enforceShellEnvironmentPolicyExcludes(home, env);
    await enforceShellEnvironmentPolicyExcludes(home, env);

    const out = await fs.readFile(path.join(home, "config.toml"), "utf8");
    expect(out.match(/exclude = \[/g)).toHaveLength(1);
    expect(out).not.toContain("STALE_NAME");
  });
});
