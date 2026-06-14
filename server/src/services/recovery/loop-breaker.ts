/**
 * Cross-cycle loop-breaker for source-scoped recovery actions.
 *
 * Context (TON-2299): a successful-run-handoff escalation creates a source-scoped
 * recovery action and blocks the issue. `revalidateActiveSourceRecovery` then
 * auto-cancels that action (status=`cancelled`, outcome=`cancelled`, source
 * `source_revalidation`) the moment the issue looks live again. The owning agent's
 * next automation run re-escalates, creating a FRESH action with attemptCount reset
 * to 1 — so the per-action attempt counter can never break the loop.
 *
 * The durable signal that survives the cancel/recreate cycle is the persisted
 * history of auto-cancelled recovery rows. Counting those rows for an issue gives a
 * cross-cycle counter that does NOT reset. Once it crosses a threshold we stop
 * re-handing-off and pin the issue to a terminal manual-review state that
 * `source_revalidation` will refuse to auto-resolve.
 */

export const RECOVERY_LOOP_BREAKER_THRESHOLD = 3;

/** Evidence key set on the recovery action when the loop-breaker engages. */
export const RECOVERY_LOOP_BREAKER_EVIDENCE_KEY = "loopBreakerActivated";

/** Marker embedded in the one-time system comment so we never post it twice. */
export const RECOVERY_LOOP_BREAKER_COMMENT_MARKER = "recovery.loop_breaker_activated";

/** Activity action emitted when the loop-breaker engages. */
export const RECOVERY_LOOP_BREAKER_ACTIVITY_ACTION = "recovery.loop_breaker_activated";

/**
 * Decide whether the cross-cycle loop-breaker should engage for this escalation.
 *
 * `priorAutoResolveCount` is the number of recovery actions for the same
 * (companyId, sourceIssueId) that were previously auto-cancelled by
 * `source_revalidation`. Each completed cancel/recreate cycle contributes one row,
 * so the count is a true cross-cycle repeat counter that survives the reset.
 */
export function decideRecoveryLoopBreaker(input: {
  priorAutoResolveCount: number;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? RECOVERY_LOOP_BREAKER_THRESHOLD;
  if (!Number.isFinite(input.priorAutoResolveCount) || input.priorAutoResolveCount < 0) {
    return false;
  }
  return input.priorAutoResolveCount >= threshold;
}

/**
 * True when a recovery action's evidence carries the loop-breaker flag. Used by the
 * revalidation skip-guard so `source_revalidation` never auto-resolves a pinned
 * loop-breaker action.
 */
export function recoveryActionEvidenceHasLoopBreaker(evidence: unknown): boolean {
  return Boolean(
    evidence &&
      typeof evidence === "object" &&
      (evidence as Record<string, unknown>)[RECOVERY_LOOP_BREAKER_EVIDENCE_KEY] === true,
  );
}
