import { describe, expect, it } from "vitest";
import {
  applyHermesTerminalDisposition,
  buildHermesTerminalDispositionContract,
} from "./hermes-terminal-disposition.js";

type Ctx = { config: Record<string, unknown>; context: Record<string, unknown>; authToken?: string };
const ctxOf = (config: Record<string, unknown>, context: Record<string, unknown>, authToken?: string): Ctx => ({
  config,
  context,
  ...(authToken ? { authToken } : {}),
});

describe("buildHermesTerminalDispositionContract", () => {
  it("interpolates the concrete issue id and never leaks a template placeholder", () => {
    const contract = buildHermesTerminalDispositionContract("issue-123");
    expect(contract).toContain("issue-123");
    expect(contract).not.toContain("{{");
  });

  it("covers every disposition the handoff detector accepts", () => {
    const contract = buildHermesTerminalDispositionContract("issue-123");
    expect(contract).toContain('"status":"done"');
    expect(contract).toContain("cancelled");
    expect(contract).toContain('"status":"in_review"');
    expect(contract).toContain('"status":"blocked"');
    expect(contract).toContain("blockedByIssueIds");
    expect(contract).toContain("follow-up issue");
  });
});

describe("applyHermesTerminalDisposition", () => {
  it("bridges taskId from the run context into the adapter config", () => {
    const result = applyHermesTerminalDisposition(
      ctxOf({}, { taskId: "TON-2300-id", taskTitle: "Fix the loop" }),
    );
    expect(result.config.taskId).toBe("TON-2300-id");
    expect(result.config.taskTitle).toBe("Fix the loop");
    expect(String(result.config.taskBody)).toContain("terminal disposition");
    expect(String(result.config.taskBody)).toContain("TON-2300-id");
  });

  it("appends the contract to an existing task body instead of replacing it", () => {
    const result = applyHermesTerminalDisposition(
      ctxOf({ taskId: "abc", taskBody: "Original description." }, {}),
    );
    const body = String(result.config.taskBody);
    expect(body.startsWith("Original description.")).toBe(true);
    expect(body).toContain("record a terminal disposition");
  });

  it("prefers an explicit config taskId over the context one", () => {
    const result = applyHermesTerminalDisposition(
      ctxOf({ taskId: "config-id" }, { taskId: "context-id" }),
    );
    expect(result.config.taskId).toBe("config-id");
    expect(String(result.config.taskBody)).toContain("config-id");
  });

  it("carries commentId and wakeReason through when present in context", () => {
    const result = applyHermesTerminalDisposition(
      ctxOf({ taskId: "abc" }, { commentId: "cmt-1", wakeReason: "issue_assigned" }),
    );
    expect(result.config.commentId).toBe("cmt-1");
    expect(result.config.wakeReason).toBe("issue_assigned");
  });

  it("is a no-op when there is no task in scope (generic discovery heartbeat)", () => {
    const ctx = ctxOf({ foo: "bar" }, { wakeReason: "heartbeat" });
    const result = applyHermesTerminalDisposition(ctx);
    expect(result).toBe(ctx);
    expect(result.config.taskBody).toBeUndefined();
  });

  it("does not mutate the input context or config", () => {
    const config: Record<string, unknown> = { taskId: "abc" };
    const context: Record<string, unknown> = { taskTitle: "t" };
    const ctx = ctxOf(config, context, "tok");
    const result = applyHermesTerminalDisposition(ctx);
    expect(config).not.toHaveProperty("taskBody");
    expect(result).not.toBe(ctx);
    expect(result.config).not.toBe(config);
    expect(result.authToken).toBe("tok");
  });
});
