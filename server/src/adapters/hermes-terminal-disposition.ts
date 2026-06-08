/**
 * Terminal-disposition contract injection for Hermes (Atlas) runs.
 *
 * Why this exists (TON-2300, split from TON-2298 / diagnosed on TON-2282):
 *
 * The successful-run-handoff detector — `decideSuccessfulRunHandoff` in
 * services/recovery/successful-run-handoff.ts — fires
 * `issue.successful_run_handoff_required` on EVERY succeeded run that leaves its
 * assigned issue in `in_progress` with no recognized disposition (no status
 * change off in_progress, no first-class blocker, no pending interaction/approval,
 * no active execution path). It judges *issue state*, not run-output prose.
 *
 * The vendored Hermes adapter (`hermes-paperclip-adapter`) only documents the
 * "mark done" happy path in its prompt, and — because paperclip-core never wires
 * run task context into the adapter config (`ctx.config.taskId` etc. are unset) —
 * the agent actually receives the generic no-task heartbeat prompt with NO
 * disposition guidance at all. So a Hermes run that can't finish exits 0, leaves
 * the issue in `in_progress`, and re-triggers the handoff every run. The server
 * loop-breaker is only a safety net; this is the upstream root.
 *
 * This module bridges the run's task context into the adapter config and appends
 * an explicit terminal-disposition contract to the task body, so every Hermes task
 * run is instructed to record exactly one disposition the detector accepts. The
 * contract mirrors `SUCCESSFUL_RUN_HANDOFF_OPTIONS` /
 * `buildSuccessfulRunHandoffInstruction`.
 *
 * Note: placeholders like `{{taskId}}` are intentionally NOT used in the contract
 * body — the adapter's `renderTemplate` pass does not re-render values substituted
 * into `{{taskBody}}`, so the concrete issue id is interpolated here in JS instead.
 */

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Build the terminal-disposition contract for a concrete issue. The issue id is
 * interpolated directly; curl targets reference the Paperclip API base that the
 * adapter's task prompt already prints ("API Base: ...") above the task body.
 */
export function buildHermesTerminalDispositionContract(taskId: string): string {
  return [
    "## Required before you stop: record a terminal disposition",
    "",
    `Paperclip will NOT accept this run if it ends with issue ${taskId} still \`in_progress\` and no recognized disposition. A comment, document, or "remaining work" note alone does NOT count — Paperclip judges the issue's state, not your prose, and will otherwise re-wake this issue every run.`,
    "",
    "Before you finish, choose EXACTLY ONE outcome and make the matching Paperclip API call (curl against the API base shown above, with your auth headers):",
    "",
    "1. Done / cancelled — scope is complete, or intentionally stopped:",
    `   PATCH /issues/${taskId} -d '{"status":"done"}'   (or "cancelled")`,
    "",
    "2. Needs review or input — hand off with a REAL reviewer path, not just prose:",
    `   PATCH /issues/${taskId} -d '{"status":"in_review"}'`,
    "   and give it a reviewer path — assign a human via assigneeUserId, or open a pending issue-thread interaction. `in_review` with no reviewer path is rejected.",
    "",
    "3. Blocked — cannot continue right now. Record a FIRST-CLASS blocker, not an excuse:",
    `   PATCH /issues/${taskId} -d '{"status":"blocked","blockedByIssueIds":["<blocking-issue-id>"]}'`,
    "   If there is no blocking issue, name the unblock owner AND the concrete unblock action in a comment in the same step.",
    "",
    "4. More work remains — delegate or record an explicit continuation:",
    "   - Delegate: create a follow-up issue, then block THIS issue on it (status blocked + blockedByIssueIds), or mark this issue done if its scope is independently complete.",
    "   - Continue: post a concrete next action and keep the issue actionable; never stop with only a plan or \"remaining\" bullets.",
    "",
    `Pick one and make the call before the run ends. Do not leave issue ${taskId} in \`in_progress\` with no disposition.`,
  ].join("\n");
}

/**
 * Bridge the run's task context into the Hermes adapter config and append the
 * terminal-disposition contract to the task body. Returns a NEW context object
 * (does not mutate the input); when there is no task in scope it returns the
 * context unchanged.
 */
export function applyHermesTerminalDisposition<
  T extends { config?: unknown; context?: unknown },
>(ctx: T): T {
  const config = readObject(ctx?.config);
  const context = readObject(ctx?.context);

  // taskId may already live on the adapter config; otherwise bridge it from the
  // run context snapshot, where heartbeat stores it.
  const taskId = readNonEmptyString(config.taskId) ?? readNonEmptyString(context.taskId);
  if (!taskId) {
    // No issue in scope (e.g. a generic discovery heartbeat). The handoff
    // detector only targets issue-scoped runs, so there is nothing to enforce.
    return ctx;
  }

  const taskTitle =
    readNonEmptyString(config.taskTitle) ?? readNonEmptyString(context.taskTitle) ?? "";
  const existingBody =
    readNonEmptyString(config.taskBody) ?? readNonEmptyString(context.taskBody) ?? "";
  const commentId =
    readNonEmptyString(config.commentId) ?? readNonEmptyString(context.commentId);
  const wakeReason =
    readNonEmptyString(config.wakeReason) ?? readNonEmptyString(context.wakeReason);

  const contract = buildHermesTerminalDispositionContract(taskId);
  const taskBody = existingBody ? `${existingBody}\n\n${contract}` : contract;

  const nextConfig: Record<string, unknown> = {
    ...config,
    taskId,
    taskTitle,
    taskBody,
  };
  if (commentId) nextConfig.commentId = commentId;
  if (wakeReason) nextConfig.wakeReason = wakeReason;

  return { ...ctx, config: nextConfig };
}
