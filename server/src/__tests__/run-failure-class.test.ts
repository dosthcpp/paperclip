import { describe, expect, it } from "vitest";

import {
  buildProviderBillingPauseReason,
  classifyRunFailure,
  countLeadingProviderBillingFailures,
  decideProviderBillingPause,
  isUnrecoverableRunFailure,
  PROVIDER_BILLING_EXHAUSTED_ERROR_CODE,
  PROVIDER_BILLING_PAUSE_THRESHOLD,
} from "../services/run-failure-class.js";

const billingRun = { status: "failed", error: "You're out of usage credits." };
const rateLimitedRun = { status: "failed", error: "429 rate limit exceeded" };
const succeededRun = { status: "succeeded", error: null };
const otherFailureRun = { status: "failed", error: "TypeError: undefined is not a function" };

describe("classifyRunFailure", () => {
  it("classifies the exact TON-3268 credit-exhaustion message as an unrecoverable billing wall", () => {
    // Verbatim from the observed CTO failure loop (2026-07-14 17:14-17:24Z).
    const error =
      "Claude run failed: subtype=success: You're out of usage credits. " +
      "Run /usage-credits to keep using Fable 5 or /model to switch models.";

    expect(classifyRunFailure({ error })).toBe("provider_billing_exhausted");
    expect(isUnrecoverableRunFailure(classifyRunFailure({ error }))).toBe(true);
  });

  it.each([
    "Your credit balance is too low to access the Anthropic API",
    "insufficient_quota: You exceeded your current quota",
    "HTTP 402 Payment Required",
    "Please purchase more credits to continue",
  ])("classifies %j as a billing wall", (error) => {
    expect(classifyRunFailure({ error })).toBe("provider_billing_exhausted");
  });

  it.each([
    "Claude usage limit reached. Your limit will reset at 5pm.",
    "429 Too Many Requests",
    "rate_limit_error: number of requests has exceeded your rate limit",
    "Retry-After: 60",
  ])("classifies %j as recoverable rate limiting, not a billing wall", (error) => {
    expect(classifyRunFailure({ error })).toBe("provider_rate_limited");
    expect(isUnrecoverableRunFailure(classifyRunFailure({ error }))).toBe(false);
  });

  it("prefers the recoverable verdict when a message carries both signals", () => {
    // Bias check: a wrong "hard" verdict pauses a healthy agent; a wrong
    // "recoverable" verdict costs one cheap retry. Recoverable must win.
    const error = "Rate limit reached; if this persists, purchase more credits.";
    expect(classifyRunFailure({ error })).toBe("provider_rate_limited");
  });

  it("treats an already-classified error code as authoritative", () => {
    expect(
      classifyRunFailure({ errorCode: PROVIDER_BILLING_EXHAUSTED_ERROR_CODE, error: null }),
    ).toBe("provider_billing_exhausted");
    expect(classifyRunFailure({ errorCode: "claude_transient_upstream" })).toBe("transient_upstream");
  });

  it("falls back to the adapter payload when the top-level error is empty", () => {
    expect(
      classifyRunFailure({
        error: null,
        resultJson: { errorMessage: "You're out of usage credits." },
      }),
    ).toBe("provider_billing_exhausted");
  });

  it("leaves ordinary failures unclassified so their retry policy is unchanged", () => {
    expect(classifyRunFailure({ error: "TypeError: cannot read property 'id' of undefined" }))
      .toBe("unclassified");
    expect(classifyRunFailure({})).toBe("unclassified");
    expect(classifyRunFailure({ error: "   " })).toBe("unclassified");
    expect(isUnrecoverableRunFailure("unclassified")).toBe(false);
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

  it("reproduces the TON-3268 hot loop: the rate-limit path stays retryable", () => {
    // The whole point of the split. A rate-limited agent must keep its existing
    // retry behaviour (waiting is the remedy); only the credit wall pauses.
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
