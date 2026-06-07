/**
 * Hermes Agent adapter for Paperclip — first-class, in-tree (TON-2230, Option B).
 *
 * This package vendors the Hermes Agent adapter into the Paperclip monorepo so
 * the team can maintain it in-tree instead of depending on the frozen external
 * npm package `hermes-paperclip-adapter` (pinned `^0.2.0`, last meaningful
 * publish 2026-03-31). Bringing it in-tree is what unblocks the capabilities
 * the external package never delivered to Hermes:
 *
 *   - instruction bundle delivery (TOOLS.md / HEARTBEAT.md / AGENTS.md) via
 *     `supportsInstructionsBundle: true` + `instructionsPathKey`
 *   - wake-context / thread injection
 *   - session continuity (`--resume`)
 *   - `--max-turns` / `--yolo` so agent runs don't "print code and die"
 *   - timeout falsy-zero fix
 *
 * Migration is staged (see IMPLEMENTATION.md). Phase 1 establishes this package
 * boundary; the server surface is ported in follow-up child issues.
 */

/** Adapter type identifier registered with Paperclip. */
export const type = "hermes_local";

/** Human-readable label shown in the Paperclip UI. */
export const label = "Hermes Agent";

/**
 * Key in the agent's adapterConfig that holds the absolute path to a markdown
 * instructions file. Wiring this as the adapter's `instructionsPathKey` is what
 * makes Paperclip materialize TOOLS.md / HEARTBEAT.md / AGENTS.md for Hermes —
 * the missing piece behind the original issue ("tools.md / heartbeat.md 위치는?").
 */
export const INSTRUCTIONS_PATH_KEY = "instructionsFilePath";

/**
 * Models available through Hermes Agent.
 *
 * Hermes supports any model via any provider, so availability depends on the
 * user's local `~/.hermes/.env`. The UI prefers detectModel() + manual entry
 * over a curated placeholder list.
 */
export const models: { id: string; label: string }[] = [];

/** Documentation shown in the Paperclip UI when configuring a Hermes agent. */
export const agentConfigurationDoc = `# Hermes Agent Configuration

Hermes Agent is a full-featured AI agent by Nous Research with 30+ native
tools, persistent memory, session persistence, skills, and MCP support.

## Prerequisites

- Python 3.10+ installed
- Hermes Agent installed: \`pip install hermes-agent\`
- At least one LLM API key configured in ~/.hermes/.env

## Core Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| model | string | (Hermes configured default) | Optional explicit model in provider/model format. Leave blank to use Hermes's configured default. |
| provider | string | (auto) | API provider; usually auto-detected from the model name. |
| timeoutSec | number | 300 | Execution timeout in seconds. A value of 0 means "no timeout" and is honored (no longer coerced to the default). |
| graceSec | number | 10 | Grace period after SIGTERM before SIGKILL. |
| ${INSTRUCTIONS_PATH_KEY} | string | (none) | Absolute path to a markdown instructions file (e.g. TOOLS.md / HEARTBEAT.md / AGENTS.md) delivered to the agent at runtime via Paperclip's instruction bundle. |
| maxTurns | number | (Hermes default) | Agent turn budget per run; prevents single-turn "print code and exit". |
| yolo | boolean | false | Bypass dangerous-command approval prompts (agents have no TTY). |
| toolsets | string | (all) | Comma-separated toolsets to enable (e.g. "terminal,file,web"). |
| persistSession | boolean | true | Resume sessions across heartbeats. |
| command | string | "hermes" | CLI binary name. |
| extraArgs | string[] | [] | Additional CLI args. |
| env | object | {} | KEY=VALUE environment variables. |
`;
