/**
 * Server-side execution logic for the Hermes Agent adapter.
 *
 * Spawns `hermes chat -q "..." -Q` as a child process, streams output,
 * and returns structured results to Paperclip.
 *
 * Verified CLI flags (hermes chat):
 *   -q/--query         single query (non-interactive)
 *   -Q/--quiet         quiet mode (no banner/spinner, only response + session_id)
 *   -m/--model         model name (e.g. anthropic/claude-sonnet-4)
 *   -t/--toolsets      comma-separated toolsets to enable
 *   --provider         inference provider (auto, openrouter, nous, etc.)
 *   -r/--resume        resume session by ID
 *   -w/--worktree      isolated git worktree
 *   -v/--verbose       verbose output
 *   --checkpoints      filesystem checkpoints
 *   --max-turns N      max tool-calling iterations per run (default 90)
 *   --yolo             bypass dangerous-command approval prompts (agents have no TTY)
 *   --source           session source tag for filtering
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  runChildProcess,
  buildPaperclipEnv,
  renderTemplate,
  ensureAbsoluteDirectory,
  parseObject,
  asString,
  joinPromptSections,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
  normalizePaperclipWakePayload,
  readPaperclipIssueWorkModeFromContext,
} from "@paperclipai/adapter-utils/server-utils";

import {
  HERMES_CLI,
  DEFAULT_TIMEOUT_SEC,
  DEFAULT_GRACE_SEC,
  DEFAULT_MODEL,
} from "../shared/constants.js";
import { detectModel, resolveProvider, type DetectedModel } from "./detect-model.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function cfgString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function cfgNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function cfgBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function cfgStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((i) => typeof i === "string") ? (v as string[]) : undefined;
}

// ---------------------------------------------------------------------------
// Wake-up prompt builder
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use \`terminal\` tool with \`curl\` for ALL Paperclip API calls (web_extract and browser cannot access localhost).

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Workflow

1. Work on the task using your tools
2. When done, mark the issue as completed:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/{{taskId}}" -H "Content-Type: application/json" -d '{"status":"done"}'\`
3. Post a completion comment on the issue summarizing what you did:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/{{taskId}}/comments" -H "Content-Type: application/json" -d '{"body":"DONE: <your summary here>"}'\`
4. If this issue has a parent (check the issue body or comments for references like TRA-XX), post a brief notification on the parent issue so the parent owner knows:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/PARENT_ISSUE_ID/comments" -H "Content-Type: application/json" -d '{"body":"{{agentName}} completed {{taskId}}. Summary: <brief>"}'\`
{{/taskId}}

{{#commentId}}
## Comment on This Issue

Someone commented. Read it:
   \`curl -s "{{paperclipApiUrl}}/issues/{{taskId}}/comments/{{commentId}}" | python3 -m json.tool\`

Address the comment, POST a reply if needed, then continue working.
{{/commentId}}

{{#noTask}}
## Heartbeat Wake — Check for Work

1. List ALL open issues assigned to you (todo, backlog, in_progress):
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}" | python3 -c "import sys,json;issues=json.loads(sys.stdin.read());[print(f'{i[\"identifier\"]} {i[\"status\"]:>12} {i[\"priority\"]:>6} {i[\"title\"]}') for i in issues if i['status'] not in ('done','cancelled')]" \`

2. If issues found, pick the highest priority one that is not done/cancelled and work on it:
   - Read the issue details: \`curl -s "{{paperclipApiUrl}}/issues/ISSUE_ID"\`
   - Do the work in the project directory: {{projectName}}
   - When done, mark complete and post a comment (see Workflow steps 2-4 above)

3. If no issues assigned to you, check for unassigned issues:
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?status=backlog" | python3 -c "import sys,json;issues=json.loads(sys.stdin.read());[print(f'{i[\"identifier\"]} {i[\"title\"]}') for i in issues if not i.get('assigneeAgentId')]" \`
   If you find a relevant issue, assign it to yourself:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/ISSUE_ID" -H "Content-Type: application/json" -d '{"assigneeAgentId":"{{agentId}}","status":"todo"}'\`

4. If truly nothing to do, report briefly what you checked.
{{/noTask}}`;

/**
 * Read a wake-context string field, preferring `ctx.context` (where the core
 * runtime injects wake data) and falling back to `ctx.config` for older
 * invocation paths. Tries each key in order and returns the first non-empty
 * value — this absorbs `AdapterExecutionContext` drift (e.g. taskId vs issueId,
 * wakeCommentId vs commentId).
 */
function ctxString(ctx: AdapterExecutionContext, ...keys: string[]): string {
  const context = parseObject(ctx.context);
  for (const key of keys) {
    const v = cfgString(context[key]);
    if (v) return v;
  }
  const legacy = parseObject(ctx.config);
  for (const key of keys) {
    const v = cfgString(legacy[key]);
    if (v) return v;
  }
  return "";
}

function buildPrompt(
  ctx: AdapterExecutionContext,
  config: Record<string, unknown>,
  options: { resumedSession?: boolean } = {},
): string {
  const resumedSession = options.resumedSession === true;
  const context = parseObject(ctx.context);
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;

  // Wake-context fields now arrive on ctx.context (taskId/issueId, wakeReason,
  // wakeCommentId/commentId). Fall back to the wake payload's issue for id/title
  // so the curl workflow targets the right issue even when only paperclipWake
  // is populated.
  const wakePayload = normalizePaperclipWakePayload(context.paperclipWake);
  const taskId =
    ctxString(ctx, "taskId", "issueId") ||
    wakePayload?.issue?.id ||
    wakePayload?.issue?.identifier ||
    "";
  const taskTitle = ctxString(ctx, "taskTitle") || wakePayload?.issue?.title || "";
  const taskBody = ctxString(ctx, "taskBody");
  const commentId =
    ctxString(ctx, "wakeCommentId", "commentId") || wakePayload?.latestCommentId || "";
  const wakeReason = ctxString(ctx, "wakeReason") || wakePayload?.reason || "";
  const agentName = ctx.agent?.name || "Hermes Agent";
  const companyName = ctxString(ctx, "companyName");
  const projectName = ctxString(ctx, "projectName");

  // Build API URL — ensure it has the /api path
  let paperclipApiUrl =
    cfgString(config.paperclipApiUrl) ||
    process.env.PAPERCLIP_API_URL ||
    "http://127.0.0.1:3100/api";

  // Ensure /api suffix
  if (!paperclipApiUrl.endsWith("/api")) {
    paperclipApiUrl = paperclipApiUrl.replace(/\/+$/, "") + "/api";
  }

  const vars: Record<string, unknown> = {
    agentId: ctx.agent?.id || "",
    agentName,
    companyId: ctx.agent?.companyId || "",
    companyName,
    runId: ctx.runId || "",
    taskId: taskId || "",
    taskTitle,
    taskBody,
    commentId,
    wakeReason,
    projectName,
    paperclipApiUrl,
  };

  // Handle conditional sections: {{#key}}...{{/key}}
  let rendered = template;

  // {{#taskId}}...{{/taskId}} — include if task is assigned
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, taskId ? "$1" : "");

  // {{#noTask}}...{{/noTask}} — include if no task
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, taskId ? "" : "$1");

  // {{#commentId}}...{{/commentId}} — include if comment exists
  rendered = rendered.replace(
    /\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g,
    commentId ? "$1" : "",
  );

  // Replace remaining {{variable}} placeholders
  const baseRendered = renderTemplate(rendered, vars);

  // Inject the full Paperclip wake payload — comment bodies, wake metadata,
  // continuation summary, thread history, execution stage — via the shared
  // renderer (the same one codex-local uses). This is the core of TON-2271:
  // previously only taskId/title/body/commentId/wakeReason reached the prompt.
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession });

  // On a resumed session the boilerplate base template was already delivered on
  // the cold-start heartbeat — send only the wake delta to keep the resume
  // prompt small and avoid re-priming the agent.
  if (resumedSession && wakePrompt) {
    return wakePrompt;
  }

  return joinPromptSections([baseRendered, wakePrompt]);
}

/**
 * Prepend the materialized instruction bundle (TOOLS.md / HEARTBEAT.md /
 * AGENTS.md) to the prompt.
 *
 * Paperclip writes the bundle to `config.instructionsFilePath` (pointing at the
 * AGENTS.md entry, with TOOLS.md / HEARTBEAT.md as siblings) when the adapter
 * declares `supportsInstructionsBundle: true` + `instructionsPathKey` — TON-2270.
 * The bundle lives in the agent's managed instructions dir, NOT the workspace
 * cwd, so Hermes has no native AGENTS.md discovery for it; we inject the
 * contents into the prompt the same way codex-local does. On a `--resume` the
 * cold-start heartbeat already delivered the bundle and the session retains it,
 * so callers skip this for resumed sessions to keep the resume prompt small.
 */
async function prependInstructionsBundle(
  prompt: string,
  config: Record<string, unknown>,
  ctx: AdapterExecutionContext,
): Promise<string> {
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  if (!instructionsFilePath) return prompt;
  try {
    const contents = await fs.readFile(instructionsFilePath, "utf8");
    const instructionsDir = `${path.dirname(instructionsFilePath)}/`;
    const prefix =
      `${contents}\n\n` +
      `The above agent instructions were loaded from ${instructionsFilePath}. ` +
      `Resolve any relative file references from ${instructionsDir}.\n\n`;
    await ctx.onLog("stdout", `[hermes] Loaded agent instructions from ${instructionsFilePath}\n`);
    return prefix + prompt;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await ctx.onLog(
      "stdout",
      `[hermes] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
    );
    return prompt;
  }
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/** Regex to extract session ID from Hermes quiet-mode output: "session_id: <id>" */
const SESSION_ID_REGEX = /^session_id:\s*(\S+)/m;
/** Regex for legacy session output format */
const SESSION_ID_REGEX_LEGACY = /session[_ ](?:id|saved)[:\s]+([a-zA-Z0-9_-]+)/i;
/** Regex to extract token usage from Hermes output. */
const TOKEN_USAGE_REGEX = /tokens?[:\s]+(\d+)\s*(?:input|in)\b.*?(\d+)\s*(?:output|out)\b/i;
/** Regex to extract cost from Hermes output. */
const COST_REGEX = /(?:cost|spent)[:\s]*\$?([\d.]+)/i;

interface ParsedHermesOutput {
  sessionId?: string | null;
  response?: string;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Response cleaning
// ---------------------------------------------------------------------------

/** Strip noise lines from a Hermes response (tool output, system messages, etc.) */
function cleanResponse(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // keep blank lines for paragraph separation
      if (t.startsWith("[tool]") || t.startsWith("[hermes]") || t.startsWith("[paperclip]"))
        return false;
      if (t.startsWith("session_id:")) return false;
      if (/^\[\d{4}-\d{2}-\d{2}T/.test(t)) return false;
      if (/^\[done\]\s*┊/.test(t)) return false;
      if (/^┊\s*[\p{Emoji_Presentation}]/u.test(t) && !/^┊\s*💬/.test(t)) return false;
      if (/^\p{Emoji_Presentation}\s*(Completed|Running|Error)?\s*$/u.test(t)) return false;
      return true;
    })
    .map((line) => {
      let t = line.replace(/^[\s]*┊\s*💬\s*/, "").trim();
      t = t.replace(/^\[done\]\s*/, "").trim();
      return t;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

function parseHermesOutput(stdout: string, stderr: string): ParsedHermesOutput {
  const combined = stdout + "\n" + stderr;
  const result: ParsedHermesOutput = {};

  // In quiet mode, Hermes outputs:
  //   <response text>
  //
  //   session_id: <id>
  const sessionMatch = stdout.match(SESSION_ID_REGEX);
  if (sessionMatch?.[1]) {
    result.sessionId = sessionMatch?.[1] ?? null;
    // The response is everything before the session_id line
    const sessionLineIdx = stdout.lastIndexOf("\nsession_id:");
    if (sessionLineIdx > 0) {
      result.response = cleanResponse(stdout.slice(0, sessionLineIdx));
    }
  } else {
    // Legacy format (non-quiet mode)
    const legacyMatch = combined.match(SESSION_ID_REGEX_LEGACY);
    if (legacyMatch?.[1]) {
      result.sessionId = legacyMatch?.[1] ?? null;
    }
    // In non-quiet mode, extract clean response from stdout by
    // filtering out tool lines, system messages, and noise
    const cleaned = cleanResponse(stdout);
    if (cleaned.length > 0) {
      result.response = cleaned;
    }
  }

  // Extract token usage
  const usageMatch = combined.match(TOKEN_USAGE_REGEX);
  if (usageMatch) {
    result.usage = {
      inputTokens: parseInt(usageMatch[1], 10) || 0,
      outputTokens: parseInt(usageMatch[2], 10) || 0,
    };
  }

  // Extract cost
  const costMatch = combined.match(COST_REGEX);
  if (costMatch?.[1]) {
    result.costUsd = parseFloat(costMatch[1]);
  }

  // Check for error patterns in stderr
  if (stderr.trim()) {
    const errorLines = stderr
      .split("\n")
      .filter((line) => /error|exception|traceback|failed/i.test(line))
      .filter((line) => !/INFO|DEBUG|warn/i.test(line)); // skip log-level noise
    if (errorLines.length > 0) {
      result.errorMessage = errorLines.slice(0, 5).join("\n");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = (ctx.agent?.adapterConfig ?? {}) as Record<string, unknown>;

  // ── Resolve configuration ──────────────────────────────────────────────
  const hermesCmd = cfgString(config.hermesCommand) || HERMES_CLI;
  const model = cfgString(config.model) || DEFAULT_MODEL;
  // Honor an explicit `timeoutSec: 0` as "no timeout". `runChildProcess` only
  // arms a kill timer when timeoutSec > 0, so 0 must reach it intact. Coercing
  // with `||` would turn 0 into DEFAULT_TIMEOUT_SEC — the TON-2099 falsy-zero
  // bug. Use `??` so only an absent / non-number config falls back to the
  // default; normalize negative values to 0 (also "no timeout").
  const configuredTimeoutSec = cfgNumber(config.timeoutSec) ?? DEFAULT_TIMEOUT_SEC;
  const timeoutSec = configuredTimeoutSec < 0 ? 0 : configuredTimeoutSec;
  const graceSec = cfgNumber(config.graceSec) || DEFAULT_GRACE_SEC;
  // Agent turn budget. Hermes `--max-turns N` caps tool-calling iterations per
  // run (its own default is 90). Only pass when explicitly configured > 0;
  // otherwise let Hermes apply its configured default.
  const maxTurns = cfgNumber(config.maxTurns);
  // Bypass Hermes dangerous-command approval prompts. Defaults ON because
  // Paperclip agents run as non-interactive subprocesses with no TTY — an
  // approval prompt has nothing to answer it and would hang until timeout,
  // denying legitimate commands (curl, python3 -c, …). Set `yolo: false` to
  // opt back into approval prompts (only useful for TTY-attached runs).
  const yolo = cfgBoolean(config.yolo) !== false;
  const toolsets = cfgString(config.toolsets) || cfgStringArray(config.enabledToolsets)?.join(",");
  const extraArgs = cfgStringArray(config.extraArgs);
  const persistSession = cfgBoolean(config.persistSession) !== false;
  const worktreeMode = cfgBoolean(config.worktreeMode) === true;
  const checkpoints = cfgBoolean(config.checkpoints) === true;

  // ── Resolve provider (defense in depth) ────────────────────────────────
  // Priority chain:
  //   1. Explicit provider in adapterConfig (user override)
  //   2. Provider from ~/.hermes/config.yaml (detected at runtime)
  //   3. Provider inferred from model name prefix
  //   4. "auto" (let Hermes decide)
  //
  // This ensures that even if the agent was created before provider tracking
  // was added, or if the model was changed without updating provider, the
  // correct provider is still used.
  let detectedConfig: DetectedModel | null = null;
  const explicitProvider = cfgString(config.provider);
  if (!explicitProvider) {
    try {
      detectedConfig = await detectModel();
    } catch {
      // Non-fatal — detection failure shouldn't block execution
    }
  }

  const { provider: resolvedProvider, resolvedFrom } = resolveProvider({
    explicitProvider,
    detectedProvider: detectedConfig?.provider,
    detectedModel: detectedConfig?.model,
    model,
  });

  // ── Resolve working directory ──────────────────────────────────────────
  // Prefer the workspace cwd from context (stable per agent/issue) so the
  // session cwd-match guard below stays consistent across heartbeats.
  const ctxObj = parseObject(ctx.context);
  const workspaceCwd = asString(parseObject(ctxObj.paperclipWorkspace).cwd, "");
  const cwd =
    workspaceCwd ||
    cfgString(config.cwd) ||
    cfgString(ctx.config?.workspaceDir) ||
    process.cwd();
  try {
    await ensureAbsoluteDirectory(cwd);
  } catch {
    // Non-fatal
  }

  // ── Resolve session resume (harden against context drift) ───────────────
  // Prefer structured sessionParams.sessionId, but fall back to the legacy
  // runtime.sessionId so a wake never cold-starts just because the params
  // shape drifted. Only resume when the saved cwd matches the current one
  // (an empty saved cwd means "any", for backward compatibility).
  const runtimeSessionParams = parseObject(ctx.runtime?.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, ctx.runtime?.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    persistSession &&
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const resumeSessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await ctx.onLog(
      "stdout",
      `[hermes] Session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}". Starting a fresh session.\n`,
    );
  }

  // ── Build prompt ───────────────────────────────────────────────────────
  const prompt = buildPrompt(ctx, config, { resumedSession: Boolean(resumeSessionId) });
  // Inject the materialized instruction bundle on cold-start runs only; resumed
  // sessions already carry it from the cold-start heartbeat (TON-2270).
  const finalPrompt = resumeSessionId
    ? prompt
    : await prependInstructionsBundle(prompt, config, ctx);

  // ── Build command args ─────────────────────────────────────────────────
  // Use -Q (quiet) to get clean output: just response + session_id line
  const useQuiet = cfgBoolean(config.quiet) !== false; // default true
  const args: string[] = ["chat", "-q", finalPrompt];
  if (useQuiet) args.push("-Q");
  if (model) {
    args.push("-m", model);
  }

  // Always pass --provider when we have a resolved one (not "auto").
  // "auto" means Hermes will decide on its own — no need to pass it.
  if (resolvedProvider !== "auto") {
    args.push("--provider", resolvedProvider);
  }

  if (toolsets) {
    args.push("-t", toolsets);
  }
  if (worktreeMode) args.push("-w");
  if (checkpoints) args.push("--checkpoints");
  if (cfgBoolean(config.verbose) === true) args.push("-v");

  // Tag sessions as "tool" source so they don't clutter the user's session history.
  // Requires hermes-agent >= PR #3255 (feat/session-source-tag).
  args.push("--source", "tool");

  // Agent turn budget — prevents a run from single-shotting ("prints code and
  // exits") when more tool-calling iterations are needed. Omitted unless > 0 so
  // Hermes falls back to its own configured default (90).
  if (maxTurns !== undefined && maxTurns > 0) {
    args.push("--max-turns", String(Math.floor(maxTurns)));
  }

  // Bypass Hermes dangerous-command approval prompts (see `yolo` above).
  // Paperclip agents run as non-interactive subprocesses with no TTY, so
  // approval prompts would always timeout and deny legitimate commands
  // (curl, python3 -c, etc.). Defaults ON; the approval system is designed
  // for human-attended interactive sessions.
  if (yolo) {
    args.push("--yolo");
  }

  // Session resume (resolved + cwd-validated above)
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  // ── Build environment ──────────────────────────────────────────────────
  const env: Record<string, string> = {
    ...process.env,
    ...buildPaperclipEnv(ctx.agent),
  } as Record<string, string>;
  if (ctx.runId) env.PAPERCLIP_RUN_ID = ctx.runId;

  // Export wake context so the agent's own tools (curl, scripts) can read it.
  // Sourced from ctx.context (with ctx.config fallback), mirroring codex-local.
  const taskId = ctxString(ctx, "taskId", "issueId");
  if (taskId) env.PAPERCLIP_TASK_ID = taskId;
  const wakeReason = ctxString(ctx, "wakeReason");
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  const wakeCommentId = ctxString(ctx, "wakeCommentId", "commentId");
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(ctx.context);
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  const wakePayloadJson = stringifyPaperclipWakePayload(ctxObj.paperclipWake);
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;

  const userEnv = config.env;
  if (userEnv && typeof userEnv === "object") {
    Object.assign(env, userEnv);
  }

  // ── Log start ──────────────────────────────────────────────────────────
  const timeoutLabel = timeoutSec > 0 ? `${timeoutSec}s` : "none";
  const maxTurnsLabel = maxTurns !== undefined && maxTurns > 0 ? String(Math.floor(maxTurns)) : "default";
  await ctx.onLog(
    "stdout",
    `[hermes] Starting Hermes Agent (model=${model}, provider=${resolvedProvider} [${resolvedFrom}], timeout=${timeoutLabel}, maxTurns=${maxTurnsLabel}, yolo=${yolo})\n`,
  );
  if (resumeSessionId) {
    await ctx.onLog("stdout", `[hermes] Resuming session: ${resumeSessionId}\n`);
  }

  // ── Execute ────────────────────────────────────────────────────────────
  // Hermes writes non-error noise to stderr (MCP init, INFO logs, etc).
  // Paperclip renders all stderr as red/error in the UI.
  // Wrap onLog to reclassify benign stderr lines as stdout.
  const wrappedOnLog = async (stream: "stdout" | "stderr", chunk: string): Promise<void> => {
    if (stream === "stderr") {
      const trimmed = chunk.trimEnd();
      // Benign patterns that should NOT appear as errors:
      // - Structured log lines: [timestamp] INFO/DEBUG/WARN: ...
      // - MCP server registration messages
      // - Python import/site noise
      const isBenign =
        /^\[?\d{4}[-/]\d{2}[-/]\d{2}T/.test(trimmed) || // structured timestamps
        /^[A-Z]+:\s+(INFO|DEBUG|WARN|WARNING)\b/.test(trimmed) || // log levels
        /Successfully registered all tools/.test(trimmed) ||
        /MCP [Ss]erver/.test(trimmed) ||
        /tool registered successfully/.test(trimmed) ||
        /Application initialized/.test(trimmed);
      if (isBenign) {
        return ctx.onLog("stdout", chunk);
      }
    }
    return ctx.onLog(stream, chunk);
  };

  const result = await runChildProcess(ctx.runId, hermesCmd, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onLog: wrappedOnLog,
  });

  // ── Parse output ───────────────────────────────────────────────────────
  const parsed = parseHermesOutput(result.stdout || "", result.stderr || "");

  await ctx.onLog(
    "stdout",
    `[hermes] Exit code: ${result.exitCode ?? "null"}, timed out: ${result.timedOut}\n`,
  );
  if (parsed.sessionId) {
    await ctx.onLog("stdout", `[hermes] Session: ${parsed.sessionId}\n`);
  }

  // ── Build result ───────────────────────────────────────────────────────
  const executionResult: AdapterExecutionResult = {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    provider: resolvedProvider,
    model,
  };

  if (parsed.errorMessage) {
    executionResult.errorMessage = parsed.errorMessage;
  }
  if (parsed.usage) {
    executionResult.usage = parsed.usage;
  }
  if (parsed.costUsd !== undefined) {
    executionResult.costUsd = parsed.costUsd;
  }

  // Summary from agent response
  if (parsed.response) {
    executionResult.summary = parsed.response.slice(0, 2000);
  }

  // Resolve the session id to persist. When a resumed run's quiet output omits
  // the session_id line, fall back to the id we resumed from so the thread is
  // not dropped on the next wake (session continuity).
  const resolvedSessionId = parsed.sessionId || resumeSessionId || null;

  // Set resultJson so Paperclip can persist run metadata (used for UI display + auto-comments)
  executionResult.resultJson = {
    result: parsed.response || "",
    session_id: resolvedSessionId,
    usage: parsed.usage || null,
    cost_usd: parsed.costUsd ?? null,
  };

  // Store session ID + cwd for next run. The cwd lets the next heartbeat
  // validate the saved session matches the current workspace before resuming.
  if (persistSession && resolvedSessionId) {
    executionResult.sessionParams = { sessionId: resolvedSessionId, cwd };
    executionResult.sessionDisplayId = resolvedSessionId.slice(0, 16);
  }

  return executionResult;
}
