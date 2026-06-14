import { describe, expect, it } from "vitest";
import {
  RECOVERY_LOOP_BREAKER_THRESHOLD,
  decideRecoveryLoopBreaker,
  recoveryActionEvidenceHasLoopBreaker,
} from "./loop-breaker.js";

describe("decideRecoveryLoopBreaker", () => {
  it("does not engage on the first escalation (no prior auto-resolves)", () => {
    expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: 0 })).toBe(false);
  });

  it("does not engage while the repeat count stays below the threshold", () => {
    for (let count = 0; count < RECOVERY_LOOP_BREAKER_THRESHOLD; count += 1) {
      expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: count })).toBe(false);
    }
  });

  it("engages once the cross-cycle repeat count reaches the threshold", () => {
    expect(
      decideRecoveryLoopBreaker({ priorAutoResolveCount: RECOVERY_LOOP_BREAKER_THRESHOLD }),
    ).toBe(true);
    expect(
      decideRecoveryLoopBreaker({ priorAutoResolveCount: RECOVERY_LOOP_BREAKER_THRESHOLD + 5 }),
    ).toBe(true);
  });

  it("honours a custom threshold", () => {
    expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: 1, threshold: 2 })).toBe(false);
    expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: 2, threshold: 2 })).toBe(true);
  });

  it("treats malformed counts as not-engaged rather than throwing", () => {
    expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: Number.NaN })).toBe(false);
    expect(decideRecoveryLoopBreaker({ priorAutoResolveCount: -3 })).toBe(false);
  });
});

describe("recoveryActionEvidenceHasLoopBreaker", () => {
  it("detects the loop-breaker flag in evidence", () => {
    expect(recoveryActionEvidenceHasLoopBreaker({ loopBreakerActivated: true })).toBe(true);
  });

  it("is false for normal evidence, falsy flags, or non-objects", () => {
    expect(recoveryActionEvidenceHasLoopBreaker({ loopBreakerActivated: false })).toBe(false);
    expect(recoveryActionEvidenceHasLoopBreaker({ latestRunId: "run-1" })).toBe(false);
    expect(recoveryActionEvidenceHasLoopBreaker({})).toBe(false);
    expect(recoveryActionEvidenceHasLoopBreaker(null)).toBe(false);
    expect(recoveryActionEvidenceHasLoopBreaker(undefined)).toBe(false);
    expect(recoveryActionEvidenceHasLoopBreaker("loopBreakerActivated")).toBe(false);
  });
});
