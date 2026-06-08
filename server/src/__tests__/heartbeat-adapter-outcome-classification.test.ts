import { describe, expect, it } from "vitest";
import {
  classifyAdapterRunOutcome,
  hasCompletedAdapterResponse,
} from "../services/heartbeat.js";

// TON-2298: a valid agent response (esp. hermes_local / Atlas) must not be
// misclassified `adapter_failed` and auto-reassigned to a different agent just
// because the adapter derived an `errorMessage` from benign stderr noise.

describe("hasCompletedAdapterResponse (TON-2298)", () => {
  it("detects a non-empty summary", () => {
    expect(hasCompletedAdapterResponse({ summary: "did the work" })).toBe(true);
  });

  it("detects a non-empty resultJson.result", () => {
    expect(
      hasCompletedAdapterResponse({ resultJson: { result: "the answer" } }),
    ).toBe(true);
  });

  it("detects a non-empty resultJson.summary", () => {
    expect(
      hasCompletedAdapterResponse({ resultJson: { summary: "the answer" } }),
    ).toBe(true);
  });

  it("returns false for empty / whitespace-only responses", () => {
    expect(hasCompletedAdapterResponse({ summary: "   " })).toBe(false);
    expect(
      hasCompletedAdapterResponse({ resultJson: { result: "" } }),
    ).toBe(false);
    expect(hasCompletedAdapterResponse({ resultJson: null })).toBe(false);
    expect(hasCompletedAdapterResponse({})).toBe(false);
  });

  it("ignores non-string result fields", () => {
    expect(
      hasCompletedAdapterResponse({ resultJson: { result: 42 } }),
    ).toBe(false);
  });
});

describe("classifyAdapterRunOutcome (TON-2298)", () => {
  it("classifies a clean exit with no errorMessage as succeeded", () => {
    expect(
      classifyAdapterRunOutcome({
        timedOut: false,
        exitCode: 0,
        errorMessage: null,
        summary: "done",
      }),
    ).toEqual({ outcome: "succeeded", demotedErrorMessage: null });
  });

  it("REGRESSION: exit 0 + valid response + benign stderr errorMessage => succeeded, not failed", () => {
    // Mirrors the hermes_local / Atlas misclassification reported on TON-2290.
    const result = classifyAdapterRunOutcome({
      timedOut: false,
      exitCode: 0,
      errorMessage: "WARNING: tool 'grep' failed for pattern foo",
      resultJson: { result: "Here is the completed analysis ..." },
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.demotedErrorMessage).toBe(
      "WARNING: tool 'grep' failed for pattern foo",
    );
  });

  it("still fails when exit 0 but there is NO completed response", () => {
    expect(
      classifyAdapterRunOutcome({
        timedOut: false,
        exitCode: 0,
        errorMessage: "Traceback: fatal error",
        resultJson: { result: "" },
        summary: null,
      }),
    ).toEqual({ outcome: "failed", demotedErrorMessage: null });
  });

  it("fails on a non-zero exit code even with a response present", () => {
    expect(
      classifyAdapterRunOutcome({
        timedOut: false,
        exitCode: 1,
        errorMessage: "crashed",
        summary: "partial output before crash",
      }).outcome,
    ).toBe("failed");
  });

  it("classifies timeouts as timed_out before anything else", () => {
    expect(
      classifyAdapterRunOutcome({
        timedOut: true,
        exitCode: 0,
        errorMessage: null,
        summary: "done",
      }).outcome,
    ).toBe("timed_out");
  });

  it("honors an already-terminal status (e.g. out-of-band cancel)", () => {
    expect(
      classifyAdapterRunOutcome({
        terminalStatus: "cancelled",
        timedOut: false,
        exitCode: 0,
        errorMessage: "ignored",
        summary: "ignored",
      }),
    ).toEqual({ outcome: "cancelled", demotedErrorMessage: null });
  });

  it("treats a null exit code (no signal) as a clean exit", () => {
    expect(
      classifyAdapterRunOutcome({
        timedOut: false,
        exitCode: null,
        errorMessage: null,
        summary: "done",
      }).outcome,
    ).toBe("succeeded");
  });
});
