/**
 * Provider failure-cause classification (TON-3278) behind a trust boundary (TON-3314).
 *
 * The scheduler re-dispatches a stranded assigned issue on every tick
 * (`heartbeatSchedulerIntervalMs`, ~30-60s). That is correct for failures that
 * clear on their own — a rate-limit window, a transient upstream 5xx — because
 * waiting is the remedy. It is 100% waste for failures that do not clear:
 * an exhausted credit balance does not refill itself. TON-3268 burned a
 * dispatch every 30-60s for ten minutes, each one dying on the same billing
 * wall, while every fleet signal still read "healthy".
 *
 * This module is the single place that answers "will waiting fix this?".
 *
 * ## The trust boundary
 *
 * A hard verdict pauses the agent — a real outage that a human must undo. So a
 * hard verdict may only be drawn from bytes the *runtime* wrote. The agent's own
 * words reach these fields verbatim: the claude_local adapter composes
 * `error` as `"Claude run failed: subtype=<x>: " + parsed.result`, and
 * `parsed.result` is the agent's final report (TON-3281 froze a healthy COO by
 * spilling its success report into `errorReason`). An agent that merely *writes
 * about* running out of credits — a postmortem, this very comment — must not be
 * able to pause itself two runs later.
 *
 * So the inputs are split by provenance:
 *
 *  - TRUSTED — `errorCode` (an enum only adapter code writes), and the provider's
 *    own terminal text, unlocked only by the runtime-authored structured shape
 *    `is_error === true && terminal_reason === "api_error"`. That shape means the
 *    API call itself failed, so the run had no agent turn to author `result` with.
 *    Only these bytes can produce a hard verdict.
 *
 *  - UNTRUSTED — everything else: `error`, an ungated `result`, `stdout`, `stderr`.
 *    These may only ever yield a *recoverable* verdict, which merely preserves the
 *    retry path we already had. Billing wording here is ignored by design.
 *
 * Untrusted bytes are read only when the trusted bytes are silent, so agent prose
 * can neither convict (a false pause) nor exculpate (talking its way out of a real
 * wall by mentioning "rate limit").
 *
 * ## Will waiting fix this?
 *
 * The discriminator is a reset clock, not the wording. "You've hit your session
 * limit · resets 7pm" heals by waiting; "You're out of usage credits. Run
 * /usage-credits ..." does not. A reset clock anywhere in the trusted text means
 * recoverable, whatever else the message says — the same bias as before: a wrong
 * "hard" verdict pauses a healthy agent, a wrong "recoverable" verdict costs one
 * cheap retry.
 */

export type RunFailureClass =
  /** Hard wall. Retrying cannot succeed; a human must add credits/fix billing. */
  | "provider_billing_exhausted"
  /** Recoverable. The window reopens on its own; keep the existing retry path. */
  | "provider_rate_limited"
  /** Recoverable. Upstream blip; already handled by the bounded transient retry. */
  | "transient_upstream"
  /** Everything else — retry policy is unchanged. */
  | "unclassified";

/** Error code persisted on a heartbeat run whose failure hit a hard billing wall. */
export const PROVIDER_BILLING_EXHAUSTED_ERROR_CODE = "provider_billing_exhausted";

/** `pauseReason` written to the agent when the hard-failure guard pauses it. */
export const PROVIDER_BILLING_PAUSE_REASON = "provider_billing_exhausted";

/**
 * Consecutive hard billing failures required before the agent is paused.
 *
 * >1 so that a single oddly-worded provider error cannot take an agent down on
 * its own; the second identical failure is what proves the wall is real.
 */
export const PROVIDER_BILLING_PAUSE_THRESHOLD = 2;

/** How far back the consecutive-failure scan looks. Cheap bound on the query. */
export const PROVIDER_BILLING_FAILURE_SCAN_LIMIT = 10;

/** Structured, runtime-authored codes that already name a hard billing wall. */
const BILLING_ERROR_CODES = new Set([PROVIDER_BILLING_EXHAUSTED_ERROR_CODE]);

const TRANSIENT_ERROR_CODES = new Set([
  "codex_transient_upstream",
  "claude_transient_upstream",
]);

/**
 * A reset clock: the provider told us when the window reopens, so waiting is the
 * remedy. Matched first, and it beats any billing wording in the same message.
 *
 * This is what separates the two look-alike Claude messages — and why the adapter's
 * own `claude_transient_upstream` label cannot be taken at face value here: its
 * regex matches "out of usage credits" too, so a real hard wall arrives wearing a
 * "transient" code (that mislabel is why the first cut of this guard never fired).
 */
const RESET_CLOCK_PATTERNS: RegExp[] = [
  /\bresets?\b[^\n]{0,24}?(\d|midnight|noon|tomorrow)/i,
  /limit will reset/i,
  /retry[\s_-]?after/i,
];

/** Recoverable-by-waiting signals. */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate[\s_-]?limit/i,
  /\b429\b/,
  /too many requests/i,
  /usage limit reached/i,
  /session limit/i,
  /\b(5[\s-]?hour|weekly) limit reached/i,
  /overloaded/i,
  /\b(503|529)\b/,
];

/**
 * Hard billing walls. No amount of waiting clears these.
 *
 * Only ever matched against TRUSTED text — see the trust boundary above.
 *
 * Sources: Claude CLI ("You're out of usage credits. Run /usage-credits ..."),
 * Anthropic API ("Your credit balance is too low to access the Anthropic API"),
 * OpenAI/codex ("insufficient_quota" / "You exceeded your current quota"),
 * and generic HTTP 402.
 */
const BILLING_PATTERNS: RegExp[] = [
  /out of usage credits/i,
  /\/usage-credits\b/,
  /credit balance is too low/i,
  /insufficient[\s_-]?quota/i,
  /exceeded your current quota/i,
  /purchase (more )?credits/i,
  /\b402\b/,
  /payment required/i,
];

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * True when the CLI terminated on an API error rather than on an agent turn.
 *
 * Both fields are written by the runtime, never by the agent. This is the shape a
 * real credit exhaustion arrives in — verbatim from runs d4940cf4 / b824d2f1:
 * `{subtype: "success", is_error: true, terminal_reason: "api_error", result:
 * "You're out of usage credits. Run /usage-credits ..."}`. A healthy run that the
 * runtime reaped reads `{is_error: false, terminal_reason: "completed"}` and its
 * `result` is the agent's own report, so it stays untrusted.
 */
function isProviderAuthoredTerminal(resultJson: Record<string, unknown>): boolean {
  if (resultJson.is_error !== true) return false;
  const reason = readNonEmptyString(
    resultJson.terminal_reason ?? resultJson.terminalReason,
  )?.toLowerCase();
  return reason === "api_error";
}

/** Bytes only the runtime/provider can have written. Eligible for a hard verdict. */
function collectTrustedText(run: {
  errorCode?: string | null;
  resultJson?: unknown;
}): string | null {
  const parts: string[] = [];

  const errorCode = readNonEmptyString(run.errorCode);
  if (errorCode) parts.push(errorCode);

  const resultJson = asRecord(run.resultJson);
  if (resultJson && isProviderAuthoredTerminal(resultJson)) {
    const result = readNonEmptyString(resultJson.result);
    if (result) parts.push(result);

    // The CLI's structured `errors` array, when it carries one.
    const errors = Array.isArray(resultJson.errors) ? resultJson.errors : [];
    for (const entry of errors) {
      const text =
        readNonEmptyString(entry) ??
        readNonEmptyString(asRecord(entry)?.message) ??
        readNonEmptyString(asRecord(entry)?.error);
      if (text) parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Bytes the agent may have authored: the adapter's failure envelope wraps the
 * agent's own final report, and stdout/stderr carry whatever its tools printed.
 * Recoverable verdicts only.
 */
function collectUntrustedText(run: {
  error?: string | null;
  resultJson?: unknown;
}): string | null {
  const parts: string[] = [];

  const error = readNonEmptyString(run.error);
  if (error) parts.push(error);

  const resultJson = asRecord(run.resultJson);
  if (resultJson) {
    for (const key of ["errorMessage", "error", "message", "result", "stderr", "stdout"]) {
      const text = readNonEmptyString(resultJson[key]);
      if (text) parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Recoverable signals. Safe to read from any provenance: the worst a forged one
 *  buys is a retry we would already have run. */
function classifyRecoverable(text: string | null): RunFailureClass | null {
  if (!text) return null;
  if (matchesAny(RESET_CLOCK_PATTERNS, text) || matchesAny(RATE_LIMIT_PATTERNS, text)) {
    return "provider_rate_limited";
  }
  return null;
}

/**
 * Classify a terminal run failure.
 *
 * Precedence: the structured billing code, then the provider's own words, then the
 * adapter's transient label, then — for recoverable verdicts only — anything else.
 */
export function classifyRunFailure(run: {
  errorCode?: string | null;
  error?: string | null;
  resultJson?: unknown;
}): RunFailureClass {
  const errorCode = readNonEmptyString(run.errorCode);

  // 1. A structured code an adapter already resolved. Runtime-authored, so it is
  //    authoritative on its own.
  if (errorCode && BILLING_ERROR_CODES.has(errorCode)) {
    return "provider_billing_exhausted";
  }

  // 2. The provider's own terminal text. This outranks the transient code below on
  //    purpose: the adapter's transient regex also matches "out of usage credits",
  //    so a hard wall reaches us mislabelled `claude_transient_upstream`.
  const trusted = collectTrustedText(run);
  const recoverableFromTrusted = classifyRecoverable(trusted);
  if (recoverableFromTrusted) return recoverableFromTrusted;
  if (trusted && matchesAny(BILLING_PATTERNS, trusted)) {
    return "provider_billing_exhausted";
  }

  // 3. The adapter's own transient classification, when it said nothing billing-ish.
  if (errorCode && TRANSIENT_ERROR_CODES.has(errorCode)) {
    return "transient_upstream";
  }

  // 4. Agent-reachable bytes. Recoverable or nothing — never a pause.
  return classifyRecoverable(collectUntrustedText(run)) ?? "unclassified";
}

/** True when retrying this failure cannot possibly succeed without human action. */
export function isUnrecoverableRunFailure(failureClass: RunFailureClass): boolean {
  return failureClass === "provider_billing_exhausted";
}

/**
 * The provider's own words for this failure, or null if it wrote none.
 *
 * Never the agent's: quoting the agent's report back to an operator as "the
 * provider error" is how a healthy agent's success summary ended up presented as
 * a failure (TON-3281).
 */
export function readProviderAuthoredFailureText(run: { resultJson?: unknown }): string | null {
  const resultJson = asRecord(run.resultJson);
  if (!resultJson || !isProviderAuthoredTerminal(resultJson)) return null;
  return readNonEmptyString(resultJson.result);
}

/**
 * Count the leading run of consecutive hard billing failures.
 *
 * `runs` must be the agent's terminal runs **newest first**. The scan stops at
 * the first run that succeeded or failed any other way: a billing failure, then
 * a success, then another billing failure is two separate incidents, not an
 * ongoing wall, and must not accumulate toward the pause threshold.
 */
export function countLeadingProviderBillingFailures(
  runs: Array<{ status: string; errorCode?: string | null; error?: string | null; resultJson?: unknown }>,
): number {
  let consecutive = 0;
  for (const run of runs) {
    if (run.status === "succeeded") break;
    if (classifyRunFailure(run) !== "provider_billing_exhausted") break;
    consecutive += 1;
  }
  return consecutive;
}

/**
 * Should the hot-loop guard pause this agent? True once the provider has
 * refused the same way on `PROVIDER_BILLING_PAUSE_THRESHOLD` runs in a row.
 */
export function decideProviderBillingPause(input: {
  consecutiveFailures: number;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? PROVIDER_BILLING_PAUSE_THRESHOLD;
  if (!Number.isFinite(input.consecutiveFailures) || input.consecutiveFailures < 0) return false;
  return input.consecutiveFailures >= threshold;
}

/** Operator-facing explanation persisted on the paused agent. */
export function buildProviderBillingPauseReason(failureReason: string | null | undefined): string {
  const detail = failureReason?.trim();
  const base =
    "Paused automatically: the model provider reported an exhausted credit balance " +
    `on ${PROVIDER_BILLING_PAUSE_THRESHOLD} consecutive runs. This does not clear by waiting — ` +
    "top up provider credits (or switch the agent's model profile), then resume the agent.";
  return detail ? `${base}\n\nProvider error: ${detail}` : base;
}
