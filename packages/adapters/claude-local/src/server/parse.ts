import type { UsageSummary } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  asBoolean,
  parseObject,
  parseJson,
} from "@paperclipai/adapter-utils/server-utils";

const CLAUDE_AUTH_REQUIRED_RE = /(?:not\s+logged\s+in|please\s+log\s+in|please\s+run\s+(?:`?claude\s+login`?|\/login)|login\s+required|requires\s+login|unauthorized|authentication\s+required|invalid\s+api\s+key[\s\S]{0,120}(?:\/login|claude\s+login|log\s+in))/i;
const URL_RE = /(https?:\/\/[^\s'"`<>()[\]{};,!?]+[^\s'"`<>()[\]{};,!.?:]+)/gi;

// Subscription exhaustion ("out of usage credits", "hit your session limit") is what the CLI
// actually says when an account runs dry, but it was absent from this list. Those runs were
// only ever classified transient by accident: the regex's loose `rate[-\s]?limit` alternative
// matched `rateLimitType` inside the CLI's rate_limit_info telemetry, which is present even on
// a healthy account. With that false positive removed (see buildClaudeTransientHaystack), the
// wording has to be matched on purpose. Anchored to the CLI's own result text, never stdout.
const CLAUDE_TRANSIENT_UPSTREAM_RE =
  /(?:rate[-\s]?limit(?:ed)?|rate_limit_error|too\s+many\s+requests|\b429\b|overloaded(?:_error)?|server\s+overloaded|service\s+unavailable|\b503\b|\b529\b|high\s+demand|try\s+again\s+later|temporarily\s+unavailable|throttl(?:ed|ing)|throttlingexception|servicequotaexceededexception|out\s+of\s+extra\s+usage|extra\s+usage\b|out\s+of\s+usage\s+credits|session\s+limit(?:\s+reached)?|claude\s+usage\s+limit\s+reached|5[-\s]?hour\s+limit\s+reached|weekly\s+limit\s+reached|usage\s+limit\s+reached|usage\s+cap\s+reached)/i;
// Feeds retryNotBefore. Credits/session-limit messages carry a "· resets 7pm (Asia/Seoul)"
// suffix; without these alternatives they parsed no reset time and the run was retried with no
// backoff at all -- the dispatch hot loop (TON-3278).
const CLAUDE_EXTRA_USAGE_RESET_RE =
  /(?:out\s+of\s+extra\s+usage|extra\s+usage|out\s+of\s+usage\s+credits|session\s+limit(?:\s+reached)?|usage\s+limit\s+reached|usage\s+cap\s+reached|5[-\s]?hour\s+limit\s+reached|weekly\s+limit\s+reached|claude\s+usage\s+limit\s+reached)[\s\S]{0,80}?\bresets?\s+(?:at\s+)?([^\n()]+?)(?:\s*\(([^)]+)\))?(?:[.!]|\n|$)/i;

export function parseClaudeStreamJson(stdout: string) {
  let sessionId: string | null = null;
  let model = "";
  let finalResult: Record<string, unknown> | null = null;
  const assistantTexts: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    if (type === "system" && asString(event.subtype, "") === "init") {
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
      model = asString(event.model, model);
      continue;
    }

    if (type === "assistant") {
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
      const message = parseObject(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const entry of content) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
        const block = entry as Record<string, unknown>;
        if (asString(block.type, "") === "text") {
          const text = asString(block.text, "");
          if (text) assistantTexts.push(text);
        }
      }
      continue;
    }

    if (type === "result") {
      finalResult = event;
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
    }
  }

  if (!finalResult) {
    return {
      sessionId,
      model,
      costUsd: null as number | null,
      usage: null as UsageSummary | null,
      summary: assistantTexts.join("\n\n").trim(),
      resultJson: null as Record<string, unknown> | null,
    };
  }

  const usageObj = parseObject(finalResult.usage);
  const usage: UsageSummary = {
    inputTokens: asNumber(usageObj.input_tokens, 0),
    cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
    outputTokens: asNumber(usageObj.output_tokens, 0),
  };
  const costRaw = finalResult.total_cost_usd;
  const costUsd = typeof costRaw === "number" && Number.isFinite(costRaw) ? costRaw : null;
  const summary = asString(finalResult.result, assistantTexts.join("\n\n")).trim();

  return {
    sessionId,
    model,
    costUsd,
    usage,
    summary,
    resultJson: finalResult,
  };
}

function extractClaudeErrorMessages(parsed: Record<string, unknown>): string[] {
  const raw = Array.isArray(parsed.errors) ? parsed.errors : [];
  const messages: string[] = [];

  for (const entry of raw) {
    if (typeof entry === "string") {
      const msg = entry.trim();
      if (msg) messages.push(msg);
      continue;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const msg = asString(obj.message, "") || asString(obj.error, "") || asString(obj.code, "");
    if (msg) {
      messages.push(msg);
      continue;
    }

    try {
      messages.push(JSON.stringify(obj));
    } catch {
      // skip non-serializable entry
    }
  }

  return messages;
}

export function extractClaudeLoginUrl(text: string): string | null {
  const match = text.match(URL_RE);
  if (!match || match.length === 0) return null;
  for (const rawUrl of match) {
    const cleaned = rawUrl.replace(/[\])}.!,?;:'\"]+$/g, "");
    if (cleaned.includes("claude") || cleaned.includes("anthropic") || cleaned.includes("auth")) {
      return cleaned;
    }
  }
  return match[0]?.replace(/[\])}.!,?;:'\"]+$/g, "") ?? null;
}

export function detectClaudeLoginRequired(input: {
  parsed: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}): { requiresLogin: boolean; loginUrl: string | null } {
  const resultText = asString(input.parsed?.result, "").trim();
  // A CLI that emitted a terminal result event was, by definition, logged in. Scanning its
  // stdout transcript for auth prose only lets an agent that reads a 401 or writes the word
  // "unauthorized" convict its own healthy run of an auth failure -- which is exactly how a
  // $2.40, 8-minute, 342KB run got stamped `claude_auth_required` (TON-3281).
  const hasTerminalResult = input.parsed !== null;
  const messages = [
    resultText,
    ...extractClaudeErrorMessages(input.parsed ?? {}),
    ...(hasTerminalResult ? [] : [input.stdout]),
    input.stderr,
  ]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const requiresLogin = messages.some((line) => CLAUDE_AUTH_REQUIRED_RE.test(line));
  return {
    requiresLogin,
    loginUrl: extractClaudeLoginUrl([input.stdout, input.stderr].join("\n")),
  };
}

/**
 * The authoritative failure verdict for a claude_local run.
 *
 * Two inputs, in strict precedence:
 *
 *  - `is_error` on the CLI's terminal `result` event. Runtime-authored, structured, and
 *    never suppressed: it is an unconditional OR. Credit exhaustion reports
 *    `{subtype: "success", is_error: true, terminal_reason: "api_error"}`, so this is what
 *    keeps a genuine billing failure red even when we reaped the process ourselves.
 *
 *  - The process exit code -- but only when we did not cause it. We SIGTERM the CLI once it
 *    emits its terminal result (terminalResultCleanup), landing exit 143. Reading our own
 *    kill back as the run's verdict is what stamped successful agents `status=error` and
 *    spilled their final reports into `errorReason` (TON-3281).
 *
 * Deliberately reads no prose. The agent authors its own stdout and result text; a verdict
 * derived from those bytes lets an agent exculpate or convict itself.
 */
export function isClaudeRunFailed(input: {
  parsed: Record<string, unknown> | null;
  exitCode: number | null;
  terminalResultCleanupKilled?: boolean;
}): boolean {
  const parsedIsError = input.parsed ? asBoolean(input.parsed.is_error, false) : false;
  const exitCodeIsAuthoritative = !input.terminalResultCleanupKilled;
  return (exitCodeIsAuthoritative && (input.exitCode ?? 0) !== 0) || parsedIsError;
}

export function describeClaudeFailure(parsed: Record<string, unknown>): string | null {
  const subtype = asString(parsed.subtype, "");
  const resultText = asString(parsed.result, "").trim();
  const errors = extractClaudeErrorMessages(parsed);

  let detail = resultText;
  if (!detail && errors.length > 0) {
    detail = errors[0] ?? "";
  }

  const parts = ["Claude run failed"];
  if (subtype) parts.push(`subtype=${subtype}`);
  if (detail) parts.push(detail);
  return parts.length > 1 ? parts.join(": ") : null;
}

export function isClaudeMaxTurnsResult(parsed: Record<string, unknown> | null | undefined): boolean {
  if (!parsed) return false;

  const subtype = asString(parsed.subtype, "").trim().toLowerCase();
  if (subtype === "error_max_turns") return true;

  const structuredStopReasons = [
    parsed.stop_reason,
    parsed.stopReason,
    parsed.error_code,
    parsed.errorCode,
  ].map((value) => asString(value, "").trim().toLowerCase());

  return structuredStopReasons.some((reason) =>
    reason === "max_turns" ||
    reason === "max_turns_exhausted" ||
    reason === "turn_limit" ||
    reason === "turn_limit_exhausted",
  );
}

export function isClaudeRefusalResult(parsed: Record<string, unknown> | null | undefined): boolean {
  if (!parsed) return false;

  // A policy refusal exits the CLI cleanly (exitCode=0, is_error=false), so it
  // must be detected from the structured fields rather than the failure flag.
  const subtype = asString(parsed.subtype, "").trim().toLowerCase();
  if (subtype === "model_refusal" || subtype === "refusal") return true;

  const structuredStopReasons = [
    parsed.stop_reason,
    parsed.stopReason,
    parsed.error_code,
    parsed.errorCode,
  ].map((value) => asString(value, "").trim().toLowerCase());

  return structuredStopReasons.some((reason) => reason === "refusal");
}

export function isClaudeUnknownSessionError(parsed: Record<string, unknown>): boolean {
  const resultText = asString(parsed.result, "").trim();
  const allMessages = [resultText, ...extractClaudeErrorMessages(parsed)]
    .map((msg) => msg.trim())
    .filter(Boolean);

  return allMessages.some((msg) =>
    /no conversation found with session id|unknown session|session .* not found|not a valid UUID|--resume requires a valid session|is not a UUID|does not match any session title/i.test(
      msg,
    ),
  );
}

export function isClaudePoisonedPreviousMessageIdError(parsed: Record<string, unknown>): boolean {
  const resultText = asString(parsed.result, "").trim();
  const allMessages = [resultText, ...extractClaudeErrorMessages(parsed)]
    .map((msg) => msg.trim())
    .filter(Boolean);

  return allMessages.some((msg) =>
    /diagnostics\.previous_message_id.*starts with `msg_`/i.test(msg),
  );
}

export function isClaudeImageProcessingError(parsed: Record<string, unknown>): boolean {
  const resultText = asString(parsed.result, "").trim();
  const allMessages = [resultText, ...extractClaudeErrorMessages(parsed)]
    .map((msg) => msg.trim())
    .filter(Boolean);

  return allMessages.some((msg) =>
    /could not process image/i.test(msg),
  );
}

/**
 * True when the CLI terminated on an API error rather than on an agent turn.
 *
 * Both fields are written by the runtime, never by the agent. A credit exhaustion arrives as
 * `{subtype: "success", is_error: true, terminal_reason: "api_error", result: "<provider text>"}`
 * -- the API call itself failed, so the run had no agent turn to author `result` with. A healthy
 * run reads `{is_error: false, terminal_reason: "completed"}` and its `result` is the agent's own
 * final report, which is why that shape must never unlock the text below (TON-3281).
 */
function isProviderAuthoredTerminal(parsed: Record<string, unknown>): boolean {
  if (!asBoolean(parsed.is_error, false)) return false;
  const reason = (asString(parsed.terminal_reason, "") || asString(parsed.terminalReason, ""))
    .trim()
    .toLowerCase();
  return reason === "api_error";
}

/**
 * A reset clock: the provider named the moment the window reopens, so waiting is the remedy.
 *
 * This -- not the wording -- is what separates the two look-alike Claude messages, both of
 * which arrive in the identical structured shape:
 *
 *   "You're out of usage credits. Run /usage-credits ..."     -> hard wall  (d4940cf4, b824d2f1)
 *   "You've hit your session limit · resets 7pm (Asia/Seoul)" -> time heals (efed1f88)
 */
const CLAUDE_RESET_CLOCK_RE =
  /(?:\bresets?\b[^\n]{0,24}?(?:\d|midnight|noon|tomorrow)|limit\s+will\s+reset|retry[-\s_]?after)/i;

/** Hard billing walls. No amount of waiting clears these; a human must add credits. */
const CLAUDE_BILLING_EXHAUSTED_RE =
  /(?:out\s+of\s+usage\s+credits|\/usage-credits\b|credit\s+balance\s+is\s+too\s+low|insufficient[\s_-]?quota|exceeded\s+your\s+current\s+quota|purchase\s+(?:more\s+)?credits|\b402\b|payment\s+required)/i;

/**
 * The structured code a hard billing wall is stamped with. The server's guard reads this as
 * authoritative and pauses the agent on the second one (`BILLING_ERROR_CODES` in
 * server/src/services/run-failure-class.ts); its text-matching path is the legacy fallback
 * for runs this adapter has not stamped.
 */
export const CLAUDE_BILLING_EXHAUSTED_ERROR_CODE = "provider_billing_exhausted";

/**
 * Does this run stand at a hard billing wall? (TON-3323)
 *
 * A hard verdict is load-bearing -- two of them pause the agent, and a human must undo that --
 * so it is drawn only from bytes the *runtime* wrote: the structured `is_error`/`terminal_reason`
 * shape gates the provider's own terminal text. Nothing here reads stdout, stderr, or an ungated
 * `result`. An agent that merely writes *about* running out of credits (a postmortem, this very
 * comment) must not be able to pause itself two runs later (TON-3281 / TON-3314).
 *
 * A reset clock beats any billing wording in the same message. The bias is deliberate and matches
 * the server's: a wrong "hard" verdict freezes a healthy agent, a wrong "recoverable" verdict
 * costs one cheap retry.
 */
export function isClaudeBillingExhausted(input: {
  parsed?: Record<string, unknown> | null;
}): boolean {
  const parsed = input.parsed ?? null;
  if (!parsed) return false;
  if (!isProviderAuthoredTerminal(parsed)) return false;

  const providerText = [asString(parsed.result, ""), ...extractClaudeErrorMessages(parsed)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
  if (!providerText) return false;

  if (CLAUDE_RESET_CLOCK_RE.test(providerText)) return false;
  return CLAUDE_BILLING_EXHAUSTED_RE.test(providerText);
}

function buildClaudeTransientHaystack(input: {
  parsed?: Record<string, unknown> | null;
  stdout?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
}): string {
  const parsed = input.parsed ?? null;
  const resultText = parsed ? asString(parsed.result, "") : "";
  const parsedErrors = parsed ? extractClaudeErrorMessages(parsed) : [];

  // Raw stdout is the full stream-json transcript: every tool result, every file the agent
  // read, every line it wrote -- plus the CLI's own `rate_limit_info` telemetry, which
  // carries a `rateLimitType` key even when the account is healthy (`status:
  // allowed_warning`). Scanning it for failure prose is self-poisoning: an agent that reads
  // a script handling HTTP 429, or merely reports on a rate-limit incident, classifies its
  // own run as a transient upstream failure and earns a retry (TON-3281).
  //
  // Once the CLI has given us a terminal result we classify only from bytes it authored:
  // its own result text, its structured errors, and stderr. Raw stdout stays in the haystack
  // only in the no-terminal-result case, where the CLI died before reporting and its error
  // text may exist nowhere else.
  const hasTerminalResult = parsed !== null;
  return [
    input.errorMessage ?? "",
    resultText,
    ...parsedErrors,
    hasTerminalResult ? "" : input.stdout ?? "",
    input.stderr ?? "",
  ]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function readTimeZoneParts(date: Date, timeZone: string) {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number.parseInt(values.get("year") ?? "", 10),
    month: Number.parseInt(values.get("month") ?? "", 10),
    day: Number.parseInt(values.get("day") ?? "", 10),
    hour: Number.parseInt(values.get("hour") ?? "", 10),
    minute: Number.parseInt(values.get("minute") ?? "", 10),
  };
}

function normalizeResetTimeZone(timeZoneHint: string | null | undefined): string | null {
  const normalized = timeZoneHint?.trim();
  if (!normalized) return null;
  if (/^(?:utc|gmt)$/i.test(normalized)) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date(0));
    return normalized;
  } catch {
    return null;
  }
}

function dateFromTimeZoneWallClock(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): Date | null {
  let candidate = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0));
  const targetUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = readTimeZoneParts(candidate, input.timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const offsetMs = targetUtc - actualUtc;
    if (offsetMs === 0) break;
    candidate = new Date(candidate.getTime() + offsetMs);
  }

  const verified = readTimeZoneParts(candidate, input.timeZone);
  if (
    verified.year !== input.year ||
    verified.month !== input.month ||
    verified.day !== input.day ||
    verified.hour !== input.hour ||
    verified.minute !== input.minute
  ) {
    return null;
  }

  return candidate;
}

function nextClockTimeInTimeZone(input: {
  now: Date;
  hour: number;
  minute: number;
  timeZoneHint: string;
}): Date | null {
  const timeZone = normalizeResetTimeZone(input.timeZoneHint);
  if (!timeZone) return null;

  const nowParts = readTimeZoneParts(input.now, timeZone);
  let retryAt = dateFromTimeZoneWallClock({
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    hour: input.hour,
    minute: input.minute,
    timeZone,
  });
  if (!retryAt) return null;

  if (retryAt.getTime() <= input.now.getTime()) {
    const nextDay = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1, 0, 0, 0, 0));
    retryAt = dateFromTimeZoneWallClock({
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: input.hour,
      minute: input.minute,
      timeZone,
    });
  }

  return retryAt;
}

function parseClaudeResetClockTime(clockText: string, now: Date, timeZoneHint?: string | null): Date | null {
  const normalized = clockText.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (!match) return null;

  const hour12 = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  let hour24 = hour12 % 12;
  if ((match[3] ?? "").toLowerCase() === "p") hour24 += 12;

  if (timeZoneHint) {
    const explicitRetryAt = nextClockTimeInTimeZone({
      now,
      hour: hour24,
      minute,
      timeZoneHint,
    });
    if (explicitRetryAt) return explicitRetryAt;
  }

  const retryAt = new Date(now);
  retryAt.setHours(hour24, minute, 0, 0);
  if (retryAt.getTime() <= now.getTime()) {
    retryAt.setDate(retryAt.getDate() + 1);
  }
  return retryAt;
}

export function extractClaudeRetryNotBefore(
  input: {
    parsed?: Record<string, unknown> | null;
    stdout?: string | null;
    stderr?: string | null;
    errorMessage?: string | null;
  },
  now = new Date(),
): Date | null {
  const haystack = buildClaudeTransientHaystack(input);
  const match = haystack.match(CLAUDE_EXTRA_USAGE_RESET_RE);
  if (!match) return null;
  return parseClaudeResetClockTime(match[1] ?? "", now, match[2]);
}

export function isClaudeTransientUpstreamError(input: {
  parsed?: Record<string, unknown> | null;
  stdout?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
}): boolean {
  const parsed = input.parsed ?? null;
  // Deterministic failures are handled by their own classifiers.
  if (parsed && (isClaudeMaxTurnsResult(parsed) || isClaudeUnknownSessionError(parsed) || isClaudeImageProcessingError(parsed) || isClaudePoisonedPreviousMessageIdError(parsed))) {
    return false;
  }
  // A hard billing wall is not transient, and this precedence has to live here rather than only
  // at the call sites: CLAUDE_TRANSIENT_UPSTREAM_RE below matches "out of usage credits" too, so
  // without this a genuine wall was stamped `claude_transient_upstream` -- wearing a retryable
  // label, it never reached the server's hard-failure guard, which is why that guard did not fire
  // once during TON-3268 (TON-3323).
  if (isClaudeBillingExhausted({ parsed })) return false;
  const loginMeta = detectClaudeLoginRequired({
    parsed,
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
  });
  if (loginMeta.requiresLogin) return false;

  const haystack = buildClaudeTransientHaystack(input);
  if (!haystack) return false;
  return CLAUDE_TRANSIENT_UPSTREAM_RE.test(haystack);
}
