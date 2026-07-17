import { describe, expect, it } from "vitest";

import {
  buildProviderBillingPauseReason,
  classifyRunFailure,
  countLeadingProviderBillingFailures,
  decideProviderBillingPause,
  isUnrecoverableRunFailure,
  PROVIDER_BILLING_EXHAUSTED_ERROR_CODE,
  PROVIDER_BILLING_PAUSE_THRESHOLD,
  readProviderAuthoredFailureText,
} from "../services/run-failure-class.js";

// Verbatim payload shapes from the TON-3268 / TON-3281 runs. All three report
// `subtype: "success"`, so only the structured fields separate them.
//
//   ee3e588a  is_error=false, terminal_reason=completed  -> CTO finished TON-3274
//   d4940cf4  is_error=true,  terminal_reason=api_error  -> credits exhausted
//   efed1f88  is_error=true,  terminal_reason=api_error  -> session limit, resets 7pm

/** The provider's own terminal text. Runtime-authored: the API call failed, so
 *  there was no agent turn to write `result` with. */
const CREDITS_EXHAUSTED_RESULT_JSON = {
  subtype: "success",
  is_error: true,
  terminal_reason: "api_error",
  result: "You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch.",
} as const;

/** Same structured shape, but the provider named a reset time — waiting is the remedy. */
const SESSION_LIMIT_RESULT_JSON = {
  subtype: "success",
  is_error: true,
  terminal_reason: "api_error",
  result: "You've hit your session limit · resets 7pm (Asia/Seoul)",
} as const;

/** A real credit-exhaustion run as it is actually persisted. The adapter's transient
 *  regex also matches "out of usage credits", so it arrives mislabelled. */
const billingRun = {
  status: "failed",
  errorCode: "claude_transient_upstream",
  error:
    "Claude run failed: subtype=success: You're out of usage credits. " +
    "Run /usage-credits to keep using Fable 5 or /model to switch.",
  resultJson: CREDITS_EXHAUSTED_RESULT_JSON,
};

const rateLimitedRun = {
  status: "failed",
  errorCode: "claude_transient_upstream",
  error: "Claude run failed: subtype=success: You've hit your session limit · resets 7pm (Asia/Seoul)",
  resultJson: SESSION_LIMIT_RESULT_JSON,
};

const succeededRun = { status: "succeeded", error: null };
const otherFailureRun = { status: "failed", error: "TypeError: undefined is not a function" };

describe("classifyRunFailure — trust boundary (TON-3314)", () => {
  it("does NOT call an agent's own prose about credits a billing wall", () => {
    // The false-pause vector. `result` here is the agent's final report and the
    // `error` envelope wraps it verbatim (TON-3281). An agent that merely writes
    // about the credit incident — a postmortem, a status comment — must not be
    // able to pause itself two runs later.
    const agentPostmortem =
      "TON-3278 is fixed. The hot loop happened because the CTO agent was out of " +
      "usage credits and the reconciler kept re-dispatching it. Purchase credits " +
      "does not apply here; HTTP 402 was never returned.";

    const run = {
      status: "failed",
      error: `Claude run failed: subtype=success: ${agentPostmortem}`,
      resultJson: {
        subtype: "success",
        is_error: false,
        terminal_reason: "completed",
        result: agentPostmortem,
      },
    };

    expect(classifyRunFailure(run)).toBe("unclassified");
    expect(isUnrecoverableRunFailure(classifyRunFailure(run))).toBe(false);
    expect(countLeadingProviderBillingFailures([run, run])).toBe(0);
    expect(decideProviderBillingPause({ consecutiveFailures: 0 })).toBe(false);
  });

  it("does NOT let agent prose in stdout/stderr reach a billing verdict", () => {
    const run = {
      status: "failed",
      error: "Claude exited with code 1",
      resultJson: {
        stdout: "$ grep -r 'out of usage credits' ./src\nsrc/billing.ts: // insufficient_quota",
        stderr: "warning: credit balance is too low (from the fixture under test)",
      },
    };
    expect(classifyRunFailure(run)).toBe("unclassified");
  });

  it("DOES call the real runtime billing payload a hard wall", () => {
    // The provider's own words, unlocked by is_error + terminal_reason=api_error.
    expect(classifyRunFailure(billingRun)).toBe("provider_billing_exhausted");
    expect(isUnrecoverableRunFailure(classifyRunFailure(billingRun))).toBe(true);
  });

  it("outranks the adapter's mislabelled transient code on a real billing payload", () => {
    // Regression for the first cut of this guard, which never fired: the adapter's
    // CLAUDE_TRANSIENT_UPSTREAM_RE matches "out of usage credits", so credit
    // exhaustion is stamped `claude_transient_upstream`. Reading that code before
    // the provider's text classified the wall as recoverable and retried forever.
    expect(billingRun.errorCode).toBe("claude_transient_upstream");
    expect(classifyRunFailure(billingRun)).toBe("provider_billing_exhausted");
  });

  it("keeps rate limiting retryable — a reset clock means waiting is the remedy", () => {
    expect(classifyRunFailure(rateLimitedRun)).toBe("provider_rate_limited");
    expect(isUnrecoverableRunFailure(classifyRunFailure(rateLimitedRun))).toBe(false);
    expect(countLeadingProviderBillingFailures([rateLimitedRun, rateLimitedRun])).toBe(0);
  });

  it("a reset clock beats billing wording in the same provider message", () => {
    // Bias: a wrong "hard" verdict pauses a healthy agent; a wrong "recoverable"
    // verdict costs one cheap retry. Recoverable wins ties.
    const run = {
      status: "failed",
      resultJson: {
        is_error: true,
        terminal_reason: "api_error",
        result: "You're out of usage credits · resets 7pm (Asia/Seoul)",
      },
    };
    expect(classifyRunFailure(run)).toBe("provider_rate_limited");
  });

  it("does NOT let agent prose talk its way out of a real billing wall", () => {
    // The false-green half. Untrusted bytes are read only when the trusted bytes
    // are silent, so "rate limit" in the agent's report cannot downgrade the
    // provider's own hard verdict.
    const run = {
      status: "failed",
      error: "Claude run failed: subtype=success: just a transient rate limit, retrying is fine",
      resultJson: {
        ...CREDITS_EXHAUSTED_RESULT_JSON,
        stderr: "rate limit; 429; retry-after: 30",
      },
    };
    expect(classifyRunFailure(run)).toBe("provider_billing_exhausted");
  });
});

describe("classifyRunFailure — structured codes", () => {
  it("treats a resolved billing error code as authoritative", () => {
    expect(
      classifyRunFailure({ errorCode: PROVIDER_BILLING_EXHAUSTED_ERROR_CODE, error: null }),
    ).toBe("provider_billing_exhausted");
  });

  it("keeps a transient code transient when nothing billing-ish is in the provider text", () => {
    expect(classifyRunFailure({ errorCode: "claude_transient_upstream" })).toBe("transient_upstream");
    expect(
      classifyRunFailure({
        errorCode: "codex_transient_upstream",
        resultJson: { is_error: true, terminal_reason: "api_error", result: "503 service unavailable" },
      }),
    ).toBe("provider_rate_limited");
  });

  it("leaves ordinary failures unclassified so their retry policy is unchanged", () => {
    expect(classifyRunFailure({ error: "TypeError: cannot read property 'id' of undefined" }))
      .toBe("unclassified");
    expect(classifyRunFailure({})).toBe("unclassified");
    expect(classifyRunFailure({ error: "   " })).toBe("unclassified");
    expect(isUnrecoverableRunFailure("unclassified")).toBe(false);
  });
});

describe("readProviderAuthoredFailureText", () => {
  it("returns the provider's words, never the agent's", () => {
    expect(readProviderAuthoredFailureText(billingRun)).toBe(CREDITS_EXHAUSTED_RESULT_JSON.result);
    expect(
      readProviderAuthoredFailureText({
        resultJson: {
          is_error: false,
          terminal_reason: "completed",
          result: "**TON-3274 is done.** The reported bug was already fixed.",
        },
      }),
    ).toBeNull();
    expect(readProviderAuthoredFailureText({})).toBeNull();
  });
});

describe("countLeadingProviderBillingFailures", () => {
  // Input is newest-first, matching the scan query's ORDER BY createdAt DESC.
  it("counts an unbroken streak of billing failures", () => {
    expect(countLeadingProviderBillingFailures([billingRun, billingRun, billingRun])).toBe(3);
  });

  it("stops at an intervening success — two incidents are not one wall", () => {
    expect(countLeadingProviderBillingFailures([billingRun, succeededRun, billingRun])).toBe(1);
  });

  it("stops at a failure of any other cause", () => {
    expect(countLeadingProviderBillingFailures([billingRun, otherFailureRun, billingRun])).toBe(1);
    expect(countLeadingProviderBillingFailures([billingRun, rateLimitedRun])).toBe(1);
  });

  it("is zero when the newest run is not a billing failure", () => {
    expect(countLeadingProviderBillingFailures([rateLimitedRun, billingRun, billingRun])).toBe(0);
    expect(countLeadingProviderBillingFailures([])).toBe(0);
  });
});

describe("decideProviderBillingPause", () => {
  it("does not pause on a single billing failure", () => {
    // One oddly-worded provider error must not be able to take an agent down.
    expect(decideProviderBillingPause({ consecutiveFailures: 1 })).toBe(false);
  });

  it("pauses once the wall is confirmed by a repeat failure", () => {
    expect(decideProviderBillingPause({ consecutiveFailures: PROVIDER_BILLING_PAUSE_THRESHOLD })).toBe(true);
    expect(decideProviderBillingPause({ consecutiveFailures: 9 })).toBe(true);
  });

  it("rejects nonsense counts", () => {
    expect(decideProviderBillingPause({ consecutiveFailures: 0 })).toBe(false);
    expect(decideProviderBillingPause({ consecutiveFailures: -1 })).toBe(false);
    expect(decideProviderBillingPause({ consecutiveFailures: Number.NaN })).toBe(false);
  });

  it("reproduces the TON-3268 hot loop: only the credit wall pauses", () => {
    const rateLimited = countLeadingProviderBillingFailures([rateLimitedRun, rateLimitedRun]);
    expect(decideProviderBillingPause({ consecutiveFailures: rateLimited })).toBe(false);

    const creditWall = countLeadingProviderBillingFailures([billingRun, billingRun]);
    expect(decideProviderBillingPause({ consecutiveFailures: creditWall })).toBe(true);
  });
});

describe("buildProviderBillingPauseReason", () => {
  it("states the remedy and embeds the provider error", () => {
    const reason = buildProviderBillingPauseReason("You're out of usage credits.");
    expect(reason).toContain("does not clear by waiting");
    expect(reason).toContain("You're out of usage credits.");
  });

  it("works without a provider error detail", () => {
    expect(buildProviderBillingPauseReason(null)).toContain("top up provider credits");
  });
});

// TON-3327: the unlock was a single value (`api_error`) out of the CLI's 19-value
// terminal_reason enum. A credit wall that arrives as `blocking_limit` therefore kept
// the trusted text locked, fell through to the adapter's mislabelled
// `claude_transient_upstream`, was read as recoverable, and the dispatch hot-loop kept
// burning money — DEFECT 2 re-entering under a different enum value.
describe("classifyRunFailure — blocking_limit terminals (TON-3327)", () => {
  /** A credit wall delivered under `blocking_limit` instead of `api_error`. */
  const blockingLimitWall = {
    status: "failed",
    errorCode: "claude_transient_upstream",
    error:
      "Claude run failed: subtype=success: You're out of usage credits. " +
      "Run /usage-credits to add more.",
    resultJson: {
      subtype: "success",
      is_error: true,
      terminal_reason: "blocking_limit",
      result: "You're out of usage credits. Run /usage-credits to add more.",
    },
  };

  /** The soft limit arrives under the same terminal reason — told apart by the clock. */
  const blockingLimitSessionWall = {
    status: "failed",
    errorCode: "claude_transient_upstream",
    error: "Claude run failed: subtype=success: You've hit your session limit · resets 7pm",
    resultJson: {
      subtype: "success",
      is_error: true,
      terminal_reason: "blocking_limit",
      result: "You've hit your session limit · resets 7pm (Asia/Seoul)",
    },
  };

  // AC1
  it("classifies a blocking_limit credit wall as a hard billing wall", () => {
    expect(classifyRunFailure(blockingLimitWall)).toBe("provider_billing_exhausted");
    expect(isUnrecoverableRunFailure(classifyRunFailure(blockingLimitWall))).toBe(true);
  });

  it("pauses the agent once the blocking_limit wall repeats — the hot loop stops", () => {
    const consecutive = countLeadingProviderBillingFailures([blockingLimitWall, blockingLimitWall]);
    expect(consecutive).toBe(PROVIDER_BILLING_PAUSE_THRESHOLD);
    expect(decideProviderBillingPause({ consecutiveFailures: consecutive })).toBe(true);
  });

  it("quotes the provider's words, not the agent's, on the paused agent", () => {
    expect(readProviderAuthoredFailureText(blockingLimitWall)).toBe(
      "You're out of usage credits. Run /usage-credits to add more.",
    );
  });

  // AC2 — the reset clock still wins, so widening the unlock adds no false-pause path.
  it("keeps a blocking_limit session limit recoverable when a reset clock is present", () => {
    expect(classifyRunFailure(blockingLimitSessionWall)).toBe("provider_rate_limited");
    const consecutive = countLeadingProviderBillingFailures([
      blockingLimitSessionWall,
      blockingLimitSessionWall,
    ]);
    expect(decideProviderBillingPause({ consecutiveFailures: consecutive })).toBe(false);
  });

  // AC3 — the trust boundary is unchanged: agent prose still cannot convict.
  it("still refuses a hard verdict from agent prose under a blocking_limit terminal", () => {
    // is_error=false => an agent turn ran => `result` is the agent's own report.
    const agentPostmortem = {
      status: "failed",
      errorCode: "claude_transient_upstream",
      error:
        "Claude run failed: subtype=success: I fixed TON-3327. Note: the fleet was " +
        "out of usage credits earlier, so /usage-credits may need a top-up.",
      resultJson: {
        subtype: "success",
        is_error: false,
        terminal_reason: "blocking_limit",
        result:
          "I fixed TON-3327. Note: the fleet was out of usage credits earlier, so " +
          "/usage-credits may need a top-up.",
      },
    };
    expect(classifyRunFailure(agentPostmortem)).toBe("transient_upstream");
    expect(countLeadingProviderBillingFailures([agentPostmortem, agentPostmortem])).toBe(0);
    expect(readProviderAuthoredFailureText(agentPostmortem)).toBeNull();
  });

  it("keeps the gate shut for terminals an agent's turn could have authored", () => {
    // A hook is agent-writable, so hook output must never earn a hard verdict —
    // even though the runtime sets the terminal reason.
    const hookStopped = {
      status: "failed",
      errorCode: "claude_transient_upstream",
      error: "Claude run failed",
      resultJson: {
        is_error: true,
        terminal_reason: "hook_stopped",
        result: "Hook says: You're out of usage credits. Run /usage-credits to add more.",
      },
    };
    expect(classifyRunFailure(hookStopped)).toBe("transient_upstream");
    expect(readProviderAuthoredFailureText(hookStopped)).toBeNull();

    // budget_exhausted is a CLI-local spend cap, not a provider refusal.
    const localBudgetCap = {
      status: "failed",
      errorCode: null,
      error: "Claude run failed",
      resultJson: {
        is_error: true,
        terminal_reason: "budget_exhausted",
        result: "Budget exhausted for this session.",
      },
    };
    expect(classifyRunFailure(localBudgetCap)).toBe("unclassified");
  });

  it("accepts the camelCase spelling of the terminal reason too", () => {
    expect(
      classifyRunFailure({
        status: "failed",
        errorCode: "claude_transient_upstream",
        resultJson: {
          is_error: true,
          terminalReason: "blocking_limit",
          result: "You're out of usage credits. Run /usage-credits to add more.",
        },
      }),
    ).toBe("provider_billing_exhausted");
  });
});
