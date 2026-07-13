import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateChild = vi.fn();

vi.mock("./issues.js", () => ({
  issueService: () => ({
    createChild: mockCreateChild,
  }),
}));

type SelectRow = Record<string, unknown>;

function createSelectChain(rows: SelectRow[]) {
  return {
    from() {
      return {
        where() {
          return {
            then(callback: (rows: SelectRow[]) => unknown) {
              return Promise.resolve(callback(rows));
            },
          };
        },
      };
    },
  };
}

function createFakeDb(args: {
  interactionRow: Record<string, unknown>;
  parentRows?: SelectRow[];
}) {
  let interactionRow = { ...args.interactionRow };
  const issueTouches: Array<Record<string, unknown>> = [];
  const interactionUpdates: Array<Record<string, unknown>> = [];
  let selectCallCount = 0;

  const db: any = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return createSelectChain(selectCallCount === 1 ? [interactionRow] : (args.parentRows ?? []));
    }),
    update: vi.fn((table: unknown) => ({
      set(values: Record<string, unknown>) {
        return {
          where() {
            if ("status" in values || "result" in values || "resolvedAt" in values) {
              interactionUpdates.push(values);
              interactionRow = { ...interactionRow, ...values };
              return {
                returning: async () => [interactionRow],
              };
            }
            if ("updatedAt" in values) {
              issueTouches.push(values);
              return Promise.resolve(undefined);
            }
            throw new Error(`Unexpected update target: ${String(table)}`);
          },
        };
      },
    })),
    insert: vi.fn(),
    transaction: async (callback: (tx: typeof db) => Promise<void>) => callback(db),
  };

  return {
    db,
    getInteractionRow: () => interactionRow,
    issueTouches,
    interactionUpdates,
  };
}

describe("issueThreadInteractionService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("create reuses an existing interaction for the same idempotency key", async () => {
    const { issueThreadInteractionService } = await import("./issue-thread-interactions.js");

    const existingRow = {
      id: "interaction-1",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      kind: "suggest_tasks",
      status: "pending",
      continuationPolicy: "wake_assignee",
      idempotencyKey: "run-1:suggest",
      sourceCommentId: null,
      sourceRunId: "22222222-2222-4222-8222-222222222222",
      title: "Break the work down",
      summary: "Created from the current agent run.",
      createdByAgentId: "agent-1",
      createdByUserId: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      payload: {
        version: 1,
        tasks: [{ clientKey: "task-1", title: "One" }],
      },
      result: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };

    const db: any = {
      select: vi.fn(() => createSelectChain([existingRow])),
      insert: vi.fn(),
      update: vi.fn(),
    };

    const svc = issueThreadInteractionService(db as never);
    const created = await svc.create({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
    }, {
      kind: "suggest_tasks",
      idempotencyKey: "run-1:suggest",
      sourceRunId: "22222222-2222-4222-8222-222222222222",
      title: "Break the work down",
      summary: "Created from the current agent run.",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [{ clientKey: "task-1", title: "One" }],
      },
    }, {
      agentId: "agent-1",
    });

    expect(created.id).toBe("interaction-1");
    expect(created.idempotencyKey).toBe("run-1:suggest");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("answerQuestions normalizes duplicate option ids and persists answered results", async () => {
    const { issueThreadInteractionService } = await import("./issue-thread-interactions.js");

    const interactionRow = {
      id: "interaction-2",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "wake_assignee",
      sourceCommentId: null,
      sourceRunId: null,
      title: null,
      summary: null,
      createdByAgentId: null,
      createdByUserId: "local-board",
      resolvedByAgentId: null,
      resolvedByUserId: null,
      payload: {
        version: 1,
        questions: [
          {
            id: "scope",
            prompt: "Pick one scope",
            selectionMode: "single",
            required: true,
            options: [
              { id: "phase-1", label: "Phase 1" },
              { id: "phase-2", label: "Phase 2" },
            ],
          },
          {
            id: "extras",
            prompt: "Pick extras",
            selectionMode: "multi",
            options: [
              { id: "tests", label: "Tests" },
              { id: "docs", label: "Docs" },
            ],
          },
        ],
      },
      result: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };
    const state = createFakeDb({ interactionRow });
    const svc = issueThreadInteractionService(state.db as never);

    const result = await svc.answerQuestions({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
    }, "interaction-2", {
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests", "docs"] },
      ],
      summaryMarkdown: "Phase 1 with tests and docs.",
    }, {
      userId: "local-board",
    });

    expect(result.status).toBe("answered");
    expect(result.result).toEqual({
      version: 1,
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests"] },
      ],
      summaryMarkdown: "Phase 1 with tests and docs.",
    });
    expect(state.interactionUpdates).toHaveLength(1);
    expect(state.issueTouches).toHaveLength(1);
  });

  it("cancelQuestions cancels a pending request_confirmation with a cancelled outcome (TON-3122)", async () => {
    const { issueThreadInteractionService } = await import("./issue-thread-interactions.js");

    const interactionRow = {
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "none",
      idempotencyKey: null,
      sourceCommentId: null,
      sourceRunId: null,
      title: null,
      summary: null,
      createdByAgentId: "agent-1",
      createdByUserId: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      payload: {
        version: 1,
        prompt: "Rotate the exposed key now?",
        supersedeOnUserComment: true,
      },
      result: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };
    const state = createFakeDb({ interactionRow });
    const svc = issueThreadInteractionService(state.db as never);

    const cancelled = await svc.cancelQuestions({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
    }, "33333333-3333-4333-8333-333333333333", {
      reason: "guard not deployed yet; rotation would re-leak",
    }, {
      agentId: "agent-1",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.result).toEqual({
      version: 1,
      outcome: "cancelled",
      reason: "guard not deployed yet; rotation would re-leak",
    });
    expect(state.interactionUpdates).toHaveLength(1);
    expect(state.issueTouches).toHaveLength(1);
  });

  it("create auto-supersedes pending cards whose idempotency key version was bumped (TON-3122)", async () => {
    const { issueThreadInteractionService } = await import("./issue-thread-interactions.js");

    const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
    const V1_ID = "44444444-4444-4444-8444-444444444444";
    const V2_ID = "55555555-5555-4555-8555-555555555555";

    const v1Row = {
      id: V1_ID,
      companyId: "company-1",
      issueId: ISSUE_ID,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "none",
      idempotencyKey: "confirmation:TON-1:store-gates:v1",
      sourceCommentId: null,
      sourceRunId: null,
      title: null,
      summary: null,
      createdByAgentId: "agent-1",
      createdByUserId: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      payload: { version: 1, prompt: "Old broad proposal", supersedeOnUserComment: true },
      result: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };
    const createdRow = {
      ...v1Row,
      id: V2_ID,
      idempotencyKey: "confirmation:TON-1:store-gates:v2-ceo-narrowed",
      payload: { version: 1, prompt: "Narrowed proposal", supersedeOnUserComment: true },
    };

    let selectCallCount = 0;
    const interactionUpdates: Array<Record<string, unknown>> = [];
    const db: any = {
      // select #1: idempotent-key lookup (miss); select #2: supersede candidates
      select: vi.fn(() => {
        selectCallCount += 1;
        return createSelectChain(selectCallCount === 1 ? [] : [v1Row]);
      }),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => [createdRow],
        }),
      })),
      update: vi.fn(() => ({
        set(values: Record<string, unknown>) {
          return {
            where() {
              if ("status" in values) {
                interactionUpdates.push(values);
                return { returning: async () => [{ ...v1Row, ...values }] };
              }
              return Promise.resolve(undefined);
            },
          };
        },
      })),
    };

    const svc = issueThreadInteractionService(db as never);
    const created = await svc.create({
      id: ISSUE_ID,
      companyId: "company-1",
    }, {
      kind: "request_confirmation",
      idempotencyKey: "confirmation:TON-1:store-gates:v2-ceo-narrowed",
      continuationPolicy: "none",
      payload: { version: 1, prompt: "Narrowed proposal", allowDeclineReason: true },
    }, {
      agentId: "agent-1",
    });

    expect(created.id).toBe(V2_ID);
    expect(interactionUpdates).toHaveLength(1);
    expect(interactionUpdates[0]?.status).toBe("expired");
    expect(interactionUpdates[0]?.result).toEqual({
      version: 1,
      outcome: "superseded_by_replacement",
      supersededByInteractionId: V2_ID,
    });
  });

  it("create leaves unrelated pending cards alone when the idempotency key is unversioned", async () => {
    const { issueThreadInteractionService } = await import("./issue-thread-interactions.js");

    const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
    const createdRow = {
      id: "66666666-6666-4666-8666-666666666666",
      companyId: "company-1",
      issueId: ISSUE_ID,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "none",
      idempotencyKey: "confirmation:TON-1:plain-key",
      sourceCommentId: null,
      sourceRunId: null,
      title: null,
      summary: null,
      createdByAgentId: "agent-1",
      createdByUserId: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      payload: { version: 1, prompt: "Plain", supersedeOnUserComment: true },
      result: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };

    const db: any = {
      select: vi.fn(() => createSelectChain([])),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => [createdRow],
        }),
      })),
      update: vi.fn(() => ({
        set() {
          return { where: () => Promise.resolve(undefined) };
        },
      })),
    };

    const svc = issueThreadInteractionService(db as never);
    await svc.create({
      id: ISSUE_ID,
      companyId: "company-1",
    }, {
      kind: "request_confirmation",
      idempotencyKey: "confirmation:TON-1:plain-key",
      continuationPolicy: "none",
      payload: { version: 1, prompt: "Plain", allowDeclineReason: true },
    }, {
      agentId: "agent-1",
    });

    // one select for the idempotency lookup only — no supersede sweep
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
