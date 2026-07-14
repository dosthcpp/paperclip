/**
 * Provider failure-cause classification (TON-3278).
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
 * Bias: when a message could be read either way, classify it as RECOVERABLE.
 * A false "hard" verdict pauses a healthy agent (a real outage that needs a
 * human to undo); a false "recoverable" verdict costs one more cheap retry.
 * The asymmetry is deliberate — recoverable patterns are matched first and win.
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

/**
 * Recoverable-by-waiting signals. Checked FIRST — see the bias note above.
 *
 * Anthropic subscription exhaustion ("Claude usage limit reached — your limit
 * will reset at 5pm") reads a lot like credit exhaustion but *is* time-healing,
 * so it must land here and not in the hard set.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate[\s_-]?limit/i,
  /\b429\b/,
  /usage limit reached/i,
  /limit will reset/i,
  /\bresets? (at|in)\b/i,
  /retry[\s_-]?after/i,
  /too many requests/i,
];

/**
 * Hard billing walls. No amount of waiting clears these.
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

const TRANSIENT_ERROR_CODES = new Set([
  "codex_transient_upstream",
  "claude_transient_upstream",
]);

function classifyText(text: string | null | undefined): RunFailureClass | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Recoverable wins ties. A message carrying both a rate-limit phrase and a
  // billing phrase is treated as the rate limit (cheap to retry, self-healing).
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "provider_rate_limited";
  }
  if (BILLING_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "provider_billing_exhausted";
  }
  return null;
}

function readResultJsonText(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const record = resultJson as Record<string, unknown>;
  const parts = [record.errorMessage, record.error, record.message, record.result, record.stderr]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Classify a terminal run failure. Reads the persisted error code first (an
 * already-classified run is authoritative), then the free-text failure message
 * the adapter surfaced.
 */
export function classifyRunFailure(run: {
  errorCode?: string | null;
  error?: string | null;
  resultJson?: unknown;
}): RunFailureClass {
  if (run.errorCode === PROVIDER_BILLING_EXHAUSTED_ERROR_CODE) {
    return "provider_billing_exhausted";
  }
  if (run.errorCode && TRANSIENT_ERROR_CODES.has(run.errorCode)) {
    return "transient_upstream";
  }

  return (
    classifyText(run.error) ??
    classifyText(readResultJsonText(run.resultJson)) ??
    classifyText(run.errorCode) ??
    "unclassified"
  );
}

/** True when retrying this failure cannot possibly succeed without human action. */
export function isUnrecoverableRunFailure(failureClass: RunFailureClass): boolean {
  return failureClass === "provider_billing_exhausted";
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
