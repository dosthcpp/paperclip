import { describe, expect, it } from "vitest";
import {
  CLAUDE_BILLING_EXHAUSTED_ERROR_CODE,
  detectClaudeLoginRequired,
  extractClaudeRetryNotBefore,
  isClaudeBillingExhausted,
  isClaudeTransientUpstreamError,
  isClaudePoisonedPreviousMessageIdError,
  isClaudeRefusalResult,
  isClaudeUnknownSessionError,
  isClaudeImageProcessingError,
  isClaudeRunFailed,
} from "./parse.js";

describe("detectClaudeLoginRequired", () => {
  it("classifies Claude's invalid API key login prompt as auth required", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "",
        stderr: "Invalid API key · Please run /login",
      }),
    ).toEqual({ requiresLogin: true, loginUrl: null });
  });

  it("does not classify a bare invalid API key as the Claude login flow", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "",
        stderr: "Invalid API key",
      }).requiresLogin,
    ).toBe(false);
  });
});

describe("isClaudeTransientUpstreamError", () => {
  it("classifies the 'out of extra usage' subscription window failure as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          result: "You're out of extra usage. Resets at 4pm (America/Chicago).",
        },
      }),
    ).toBe(true);
  });

  it("classifies Anthropic API rate_limit_error and overloaded_error as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "rate_limit_error", message: "Rate limit reached for requests." }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "overloaded_error", message: "Overloaded" }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "HTTP 429: Too Many Requests",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Bedrock ThrottlingException: slow down",
      }),
    ).toBe(true);
  });

  it("classifies the subscription 5-hour / weekly limit wording", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Claude usage limit reached — weekly limit reached. Try again in 2 days.",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "5-hour limit reached.",
      }),
    ).toBe(true);
  });

  it("does not classify login/auth failures as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Please log in. Run `claude login` first.",
      }),
    ).toBe(false);
  });

  it("does not classify max-turns or unknown-session as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: { subtype: "error_max_turns", result: "Maximum turns reached." },
      }),
    ).toBe(false);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          result: "No conversation found with session id abc-123",
          errors: [{ message: "No conversation found with session id abc-123" }],
        },
      }),
    ).toBe(false);
  });

  it("does not classify deterministic validation errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Invalid request_error: Unknown parameter 'foo'.",
      }),
    ).toBe(false);
  });

  it("does not classify poisoned previous_message_id errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          subtype: "success",
          is_error: true,
          result: "API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)",
        },
      }),
    ).toBe(false);
  });
});

// TON-3281. Fixtures are the terminal `result` events of three real production runs. All
// three report `subtype: "success"`, so subtype alone cannot separate them -- these pin the
// fields that can.
//
//   A  run ee3e588a  exit 143, is_error=false, terminal_reason=completed   -> CTO finished TON-3274
//   B  run d4940cf4  exit 1,   is_error=true,  terminal_reason=api_error   -> credits exhausted
//   C  run b824d2f1  exit 143, is_error=true,  terminal_reason=api_error   -> credits exhausted
//                                                                             after $11.79 of work
//
// A was recorded as a failure, froze the agent at `status=error`, and overwrote `errorReason`
// with the agent's own report. C is the trap: suppressing exit 143 wholesale would turn a real
// billing failure green.
const RUN_A_SUCCESS = {
  subtype: "success",
  is_error: false,
  terminal_reason: "completed",
  result: "**TON-3274 is done.** The reported bug was already fixed — but the card still bought us something real.",
} as const;

const RUN_BC_CREDITS_EXHAUSTED = {
  subtype: "success",
  is_error: true,
  terminal_reason: "api_error",
  result: "You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch.",
} as const;

describe("isClaudeRunFailed", () => {
  it("does not fail a successful run that the runtime itself reaped after its terminal result", () => {
    // The bug: exit 143 is our own SIGTERM from terminalResultCleanup, not the run's verdict.
    expect(
      isClaudeRunFailed({
        parsed: { ...RUN_A_SUCCESS },
        exitCode: 143,
        terminalResultCleanupKilled: true,
      }),
    ).toBe(false);
  });

  it("keeps credit exhaustion red even when the runtime reaped the process (exit 143)", () => {
    // The trap: is_error must stay an unconditional OR, never AND-gated by the exit code.
    expect(
      isClaudeRunFailed({
        parsed: { ...RUN_BC_CREDITS_EXHAUSTED },
        exitCode: 143,
        terminalResultCleanupKilled: true,
      }),
    ).toBe(true);
  });

  it("keeps credit exhaustion red on a plain non-zero exit", () => {
    expect(
      isClaudeRunFailed({
        parsed: { ...RUN_BC_CREDITS_EXHAUSTED },
        exitCode: 1,
        terminalResultCleanupKilled: false,
      }),
    ).toBe(true);
  });

  it("still fails a run that died on its own, cleanup or not", () => {
    expect(isClaudeRunFailed({ parsed: null, exitCode: 1 })).toBe(true);
    expect(
      isClaudeRunFailed({ parsed: { ...RUN_A_SUCCESS }, exitCode: 1, terminalResultCleanupKilled: false }),
    ).toBe(true);
  });

  it("passes a clean exit", () => {
    expect(isClaudeRunFailed({ parsed: { ...RUN_A_SUCCESS }, exitCode: 0 })).toBe(false);
  });
});

describe("claude_local classifiers do not read agent-authored bytes", () => {
  // Every Claude run emits rate_limit_info telemetry. On a healthy account it still carries a
  // `rateLimitType` key, which the transient regex matched -- so any failed run looked like a
  // rate-limit and earned a retry.
  const HEALTHY_RATE_LIMIT_TELEMETRY =
    '{"type":"system","rate_limit_info":{"status":"allowed_warning","rateLimitType":"seven_day","utilization":0.8,"isUsingOverage":false}}';

  // An agent reading its own deploy script -- i.e. ordinary tool output.
  const AGENT_TOOL_OUTPUT =
    '{"type":"user","content":"429) echo \\"FAIL  rate limited — too many submissions\\" >&2; exit 1 ;;"}';

  it("does not call a completed run transient because its stdout mentions rate limits", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: { ...RUN_A_SUCCESS },
        stdout: [HEALTHY_RATE_LIMIT_TELEMETRY, AGENT_TOOL_OUTPUT].join("\n"),
        stderr: "",
      }),
    ).toBe(false);
  });

  it("does not call a completed run auth-required because its stdout mentions 401/unauthorized", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: { ...RUN_A_SUCCESS },
        stdout: '{"type":"user","content":"the API key returns 401 unauthorized; authentication required"}',
        stderr: "",
      }).requiresLogin,
    ).toBe(false);
  });

  it("still reads stdout when the CLI died before emitting a terminal result", () => {
    // No terminal result: the CLI's own error text may exist nowhere else.
    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "Not logged in. Please run `claude login`.",
        stderr: "",
      }).requiresLogin,
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: null,
        stdout: "API Error: 529 overloaded_error",
        stderr: "",
      }),
    ).toBe(true);
  });

  it("still classifies a genuine upstream failure from the CLI's own result text", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          result: "API Error: 529 overloaded_error · the service is temporarily unavailable",
        },
      }),
    ).toBe(true);
  });

  it("no longer calls a hard credit wall transient (TON-3323)", () => {
    // This assertion is inverted on purpose. The transient regex matches "out of usage credits",
    // so runs d4940cf4 / b824d2f1 were stamped `claude_transient_upstream` -- a retryable label.
    // Wearing it, they never reached the server's hard-failure guard, which is why that guard did
    // not fire once during the incident it was written for.
    expect(isClaudeTransientUpstreamError({ parsed: { ...RUN_BC_CREDITS_EXHAUSTED } })).toBe(false);
  });

  it("classifies the session-limit wording and recovers its reset time for backoff", () => {
    // Verbatim from run efed1f88. Previously matched nothing here, so the run was retried
    // with no backoff at all.
    const parsed = {
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      result: "You've hit your session limit · resets 7pm (Asia/Seoul)",
    };
    expect(isClaudeTransientUpstreamError({ parsed })).toBe(true);

    const now = new Date("2026-07-14T06:00:00Z"); // 15:00 Asia/Seoul
    const retryAt = extractClaudeRetryNotBefore({ parsed }, now);
    expect(retryAt).not.toBeNull();
    expect(retryAt!.toISOString()).toBe("2026-07-14T10:00:00.000Z"); // 19:00 Asia/Seoul
  });
});

describe("isClaudeBillingExhausted (TON-3323)", () => {
  // Verbatim from run efed1f88: the same structured shape as a hard wall, but the provider named
  // the moment the window reopens. Time is the remedy, so it must stay retryable.
  const RUN_EFED_SESSION_LIMIT = {
    subtype: "success",
    is_error: true,
    terminal_reason: "api_error",
    result: "You've hit your session limit · resets 7pm (Asia/Seoul)",
  } as const;

  it("stamps a real credit exhaustion as a hard wall (runs d4940cf4 / b824d2f1)", () => {
    expect(isClaudeBillingExhausted({ parsed: { ...RUN_BC_CREDITS_EXHAUSTED } })).toBe(true);
  });

  it("leaves a session limit with a reset clock recoverable (run efed1f88)", () => {
    // The reset clock wins over the "limit" wording -- and this run keeps its transient label
    // and its backoff, so nothing about its retry path changes.
    expect(isClaudeBillingExhausted({ parsed: { ...RUN_EFED_SESSION_LIMIT } })).toBe(false);
    expect(isClaudeTransientUpstreamError({ parsed: { ...RUN_EFED_SESSION_LIMIT } })).toBe(true);
  });

  it("does not let an agent's own prose about credits convict its run (run ee3e588a)", () => {
    // The false-pause vector. A healthy run's `result` IS the agent's final report, so billing
    // wording there is the agent talking -- and two hard verdicts pause the agent for a human to
    // undo. Provenance, not wording, is what gates the verdict (TON-3281 / TON-3314).
    const agentPostmortem = {
      subtype: "success",
      is_error: false,
      terminal_reason: "completed",
      result:
        "TON-3278 is fixed. The hot loop happened because the CTO agent was out of usage credits " +
        "and the reconciler kept re-dispatching it. Run /usage-credits does not apply here; " +
        "HTTP 402 was never returned.",
    };
    expect(isClaudeBillingExhausted({ parsed: agentPostmortem })).toBe(false);
  });

  it("ignores billing wording that is not gated by the runtime's api_error shape", () => {
    // is_error alone is not provenance: a failed run's `result` can still be agent-authored.
    expect(
      isClaudeBillingExhausted({
        parsed: {
          subtype: "success",
          is_error: true,
          terminal_reason: "completed",
          result: "You're out of usage credits. Run /usage-credits to keep using Fable 5.",
        },
      }),
    ).toBe(false);
  });

  it("reads the CLI's structured errors[] as provider-authored", () => {
    expect(
      isClaudeBillingExhausted({
        parsed: {
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          errors: [{ message: "Your credit balance is too low to access the Anthropic API" }],
        },
      }),
    ).toBe(true);
  });

  it("draws no verdict when the CLI died before emitting a terminal result", () => {
    // No structured shape, no provenance, no hard verdict -- however the stdout reads.
    expect(isClaudeBillingExhausted({ parsed: null })).toBe(false);
  });

  it("does not read errors[] fields the server would not trust", () => {
    // Narrower than extractClaudeErrorMessages on purpose: no `code`, no JSON.stringify
    // fallback. A hard verdict is unappealable -- the server trusts our errorCode before
    // applying its own reset-clock check -- so the readable surface must match
    // collectTrustedText in run-failure-class.ts and no more.
    expect(
      isClaudeBillingExhausted({
        parsed: {
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          errors: [{ detail: "tool wrote: out of usage credits" }],
        },
      }),
    ).toBe(false);
  });

  it("pins the wire contract string the server's guard keys on", () => {
    // This literal crosses a process boundary: the adapter ships as a separately-built
    // plugin and cannot import the server's PROVIDER_BILLING_EXHAUSTED_ERROR_CODE. Renaming
    // either side silently un-fires the hard-failure guard and restores the TON-3278 hot
    // loop, so both sides pin the value. Counterpart: BILLING_ERROR_CODES in
    // server/src/services/run-failure-class.ts.
    expect(CLAUDE_BILLING_EXHAUSTED_ERROR_CODE).toBe("provider_billing_exhausted");
  });
});

describe("isClaudePoisonedPreviousMessageIdError", () => {
  it("detects the previous_message_id 400 error in the result field", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        subtype: "success",
        is_error: true,
        result: "API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)",
      }),
    ).toBe(true);
  });

  it("detects the error in the errors array", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        is_error: true,
        result: "",
        errors: [{ message: "400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)" }],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        is_error: true,
        result: "No conversation found with session id abc-123",
      }),
    ).toBe(false);
  });

  it("returns false for empty parsed result", () => {
    expect(isClaudePoisonedPreviousMessageIdError({})).toBe(false);
  });
});

describe("isClaudeRefusalResult", () => {
  it("detects stop_reason: refusal even on a clean (is_error=false) result", () => {
    expect(
      isClaudeRefusalResult({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "refusal",
        result: "",
      }),
    ).toBe(true);
  });

  it("detects the camelCase stopReason variant", () => {
    expect(isClaudeRefusalResult({ stopReason: "refusal" })).toBe(true);
  });

  it("detects subtype: model_refusal", () => {
    expect(
      isClaudeRefusalResult({ subtype: "model_refusal", is_error: false }),
    ).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(isClaudeRefusalResult({ stop_reason: "  Refusal " })).toBe(true);
  });

  it("returns false for ordinary successful turns", () => {
    expect(
      isClaudeRefusalResult({
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        result: "Here is your answer.",
      }),
    ).toBe(false);
  });

  it("returns false for max-turns and other stop reasons", () => {
    expect(isClaudeRefusalResult({ stop_reason: "max_turns" })).toBe(false);
    expect(isClaudeRefusalResult({ subtype: "error_max_turns" })).toBe(false);
  });

  it("returns false for null/empty parsed result", () => {
    expect(isClaudeRefusalResult(null)).toBe(false);
    expect(isClaudeRefusalResult({})).toBe(false);
  });
});

describe("isClaudeUnknownSessionError", () => {
  it("detects the legacy 'no conversation found' message", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Error: No conversation found with session id 1234",
      }),
    ).toBe(true);
  });

  it("detects 'session ... not found' style errors", () => {
    expect(
      isClaudeUnknownSessionError({
        errors: [{ message: "Session abc123 not found" }],
      }),
    ).toBe(true);
  });

  it("detects '--resume requires a valid session' validation error from non-UUID input", () => {
    expect(
      isClaudeUnknownSessionError({
        errors: [
          {
            message:
              'Error: --resume requires a valid session ID or session title when used with --print. Usage: claude -p --resume <session-id|title>. Provided value "ses_268c2d0a5ffemYbEaeG7c86Uvo" is not a UUID and does not match any session title.',
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated error text", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Some other failure",
        errors: [{ message: "Network timeout" }],
      }),
    ).toBe(false);
  });
});

describe("isClaudeImageProcessingError", () => {
  it("detects the 'Could not process image' 400 error in the result field", () => {
    expect(
      isClaudeImageProcessingError({
        subtype: "success",
        is_error: true,
        result: "API Error: 400 Could not process image: image source URL has expired",
      }),
    ).toBe(true);
  });

  it("detects the error in the errors array", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "",
        errors: [{ message: "400 Could not process image" }],
      }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "could not process image attached to message",
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "No conversation found with session id abc-123",
      }),
    ).toBe(false);
  });

  it("returns false for empty parsed result", () => {
    expect(isClaudeImageProcessingError({})).toBe(false);
  });
});

describe("extractClaudeRetryNotBefore", () => {
  it("parses the 'resets 4pm' hint in its explicit timezone", () => {
    const now = new Date("2026-04-22T15:15:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)" },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-22T21:00:00.000Z");
  });

  it("rolls forward past midnight when the reset time has already passed today", () => {
    const now = new Date("2026-04-22T23:30:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "Usage limit reached. Resets at 3:15 AM (UTC)." },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-23T03:15:00.000Z");
  });

  it("returns null when no reset hint is present", () => {
    expect(
      extractClaudeRetryNotBefore({ errorMessage: "Overloaded. Try again later." }, new Date()),
    ).toBeNull();
  });
});
