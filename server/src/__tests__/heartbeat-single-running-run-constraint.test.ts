import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  executionWorkspaces,
  heartbeatRuns,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { canClaimHeartbeatConcurrencySlot, heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Single-running-run constraint test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres single-running-run constraint tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat workspace-scoped running run constraints (TON-3201)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-single-running-run-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await db.execute(sql`
      truncate table
        heartbeat_runs,
        agent_wakeup_requests,
        agent_runtime_state,
        issues,
        execution_workspaces,
        projects,
        agents,
        companies
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent(maxConcurrentRuns?: number) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "ClaudeCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
        },
      },
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function seedRun(input: {
    companyId: string;
    agentId: string;
    status: "queued" | "running";
    concurrencyScopeKey?: string;
    concurrencySessionKey?: string | null;
    concurrencyIsolated?: boolean;
    issueId?: string;
  }) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "test-assignment-wake",
      payload: {},
      status: input.status,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: input.status,
      wakeupRequestId,
      contextSnapshot: {
        wakeReason: "test-assignment-wake",
        ...(input.issueId ? { issueId: input.issueId, taskId: input.issueId } : {}),
      },
      ...(input.status === "running"
        ? {
            startedAt: new Date(),
            concurrencyScopeKey: input.concurrencyScopeKey ?? `agent-fallback:${input.agentId}`,
            concurrencySessionKey: input.concurrencySessionKey ?? null,
            concurrencyIsolated: input.concurrencyIsolated ?? false,
          }
        : {}),
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
    return { runId, wakeupRequestId };
  }

  async function expectConstraint(error: unknown, constraint: string) {
    expect(error).toBeTruthy();
    const chain: string[] = [];
    for (let cursor = error; cursor && typeof cursor === "object"; cursor = (cursor as { cause?: unknown }).cause) {
      chain.push(String((cursor as { message?: unknown }).message ?? cursor));
    }
    expect(chain.join(" | ")).toContain(constraint);
  }

  it("does not mix serial and isolated claims for one agent", () => {
    expect(canClaimHeartbeatConcurrencySlot({
      isolated: true,
      runningCount: 1,
      serialRunningCount: 1,
      maxConcurrentRuns: 5,
    })).toBe(false);
    expect(canClaimHeartbeatConcurrencySlot({
      isolated: false,
      runningCount: 1,
      serialRunningCount: 0,
      maxConcurrentRuns: 5,
    })).toBe(false);
    expect(canClaimHeartbeatConcurrencySlot({
      isolated: true,
      runningCount: 4,
      serialRunningCount: 0,
      maxConcurrentRuns: 5,
    })).toBe(true);
    expect(canClaimHeartbeatConcurrencySlot({
      isolated: true,
      runningCount: 5,
      serialRunningCount: 0,
      maxConcurrentRuns: 5,
    })).toBe(false);
  });

  it("serializes non-isolated or unknown running runs for the same agent", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await seedRun({ companyId, agentId, status: "running" });

    const error = await seedRun({ companyId, agentId, status: "running" }).then(
      () => null,
      (err: unknown) => err,
    );
    await expectConstraint(error, "heartbeat_runs_running_workspace_scope_uidx");
  });

  it("allows distinct isolated workspace and session scopes for the same agent", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent(5);
    await seedRun({
      companyId,
      agentId,
      status: "running",
      concurrencyScopeKey: "local:/workspace/a",
      concurrencySessionKey: "issue-a",
      concurrencyIsolated: true,
    });
    await expect(seedRun({
      companyId,
      agentId,
      status: "running",
      concurrencyScopeKey: "local:/workspace/b",
      concurrencySessionKey: "issue-b",
      concurrencyIsolated: true,
    })).resolves.toBeTruthy();
  });

  it("rejects duplicate isolated workspace scopes even across agents", async () => {
    const first = await seedCompanyAndAgent(5);
    const secondAgentId = randomUUID();
    await db.insert(agents).values({
      id: secondAgentId,
      companyId: first.companyId,
      name: "SecondCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 5 } },
      permissions: {},
    });
    await seedRun({
      ...first,
      status: "running",
      concurrencyScopeKey: "local:/workspace/shared",
      concurrencySessionKey: "issue-a",
      concurrencyIsolated: true,
    });
    const error = await seedRun({
      companyId: first.companyId,
      agentId: secondAgentId,
      status: "running",
      concurrencyScopeKey: "local:/workspace/shared",
      concurrencySessionKey: "issue-b",
      concurrencyIsolated: true,
    }).then(() => null, (err: unknown) => err);
    await expectConstraint(error, "heartbeat_runs_running_workspace_scope_uidx");
  });

  it("rejects duplicate isolated session scopes on distinct workspaces", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent(5);
    await seedRun({
      companyId,
      agentId,
      status: "running",
      concurrencyScopeKey: "local:/workspace/a",
      concurrencySessionKey: "same-issue",
      concurrencyIsolated: true,
    });
    const error = await seedRun({
      companyId,
      agentId,
      status: "running",
      concurrencyScopeKey: "local:/workspace/b",
      concurrencySessionKey: "same-issue",
      concurrencyIsolated: true,
    }).then(() => null, (err: unknown) => err);
    await expectConstraint(error, "heartbeat_runs_running_isolated_session_uidx");
  });

  it("claims five distinct persisted isolated workspaces and leaves the sixth queued", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent(5);
    await db.update(agents).set({ adapterType: "process" }).where(eq(agents.id, agentId));
    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Isolated concurrency",
      status: "in_progress",
      executionWorkspacePolicy: {
        enabled: true,
        defaultMode: "isolated_workspace",
        workspaceStrategy: { type: "project_primary" },
      },
    });

    const workspacePaths = [
      process.cwd(),
      `${process.cwd()}/server`,
      `${process.cwd()}/packages`,
      `${process.cwd()}/doc`,
      `${process.cwd()}/ui`,
      `${process.cwd()}/cli`,
    ];
    const queuedRunIds: string[] = [];
    for (const [index, cwd] of workspacePaths.entries()) {
      const executionWorkspaceId = randomUUID();
      const issueId = randomUUID();
      await db.insert(executionWorkspaces).values({
        id: executionWorkspaceId,
        companyId,
        projectId,
        mode: "isolated_workspace",
        strategyType: "project_primary",
        name: `isolated-${index}`,
        status: "active",
        cwd,
        providerType: "local_fs",
      });
      await db.insert(issues).values({
        id: issueId,
        companyId,
        projectId,
        title: `Isolated issue ${index}`,
        identifier: `ISO-${index + 1}`,
        issueNumber: index + 1,
        status: "in_progress",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
        executionWorkspaceId,
        executionWorkspacePreference: "reuse_existing",
        executionWorkspaceSettings: { mode: "isolated_workspace" },
      });
      const seeded = await seedRun({ companyId, agentId, status: "queued", issueId });
      queuedRunIds.push(seeded.runId);
    }

    let releaseAdapter!: () => void;
    const adapterGate = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    mockAdapterExecute.mockImplementation(async () => {
      await adapterGate;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorMessage: null,
        summary: "isolated run complete",
        provider: "test",
        model: "test-model",
      };
    });

    const secondHeartbeat = heartbeatService(db);
    await Promise.all([heartbeat.resumeQueuedRuns(), secondHeartbeat.resumeQueuedRuns()]);

    const deadline = Date.now() + 10_000;
    let statuses: string[] = [];
    do {
      statuses = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .then((rows) => rows.map((row) => row.status));
      if (statuses.filter((status) => status === "running").length === 5) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);

    expect(statuses.filter((status) => status === "running")).toHaveLength(5);
    expect(statuses.filter((status) => status === "queued")).toHaveLength(1);
    const runningScopes = await db
      .select({
        scope: heartbeatRuns.concurrencyScopeKey,
        isolated: heartbeatRuns.concurrencyIsolated,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    expect(new Set(runningScopes.map((row) => row.scope)).size).toBe(5);
    expect(runningScopes.every((row) => row.isolated)).toBe(true);

    releaseAdapter();
    // Let detached executeRun promises settle before fixture cleanup.
    await Promise.all(queuedRunIds.map(async (runId) => {
      const finishDeadline = Date.now() + 10_000;
      while (Date.now() < finishDeadline) {
        const status = await db
          .select({ status: heartbeatRuns.status })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, runId))
          .then((rows) => rows[0]?.status);
        if (status !== "running") return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, 30_000);

  it("keeps queued runs queued when the app-level slot check would allow a duplicate start", async () => {
    // Unknown scope candidates must remain serial even when the configured slot
    // limit is higher than one.
    const { companyId, agentId } = await seedCompanyAndAgent(5);
    await seedRun({ companyId, agentId, status: "running" });
    const queued = await seedRun({ companyId, agentId, status: "queued" });

    await expect(heartbeat.resumeQueuedRuns()).resolves.not.toThrow();

    const row = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, queued.runId))
      .then((rows) => rows[0]);
    expect(row?.status).toBe("queued");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  }, 30_000);

  // "queued run starts once the slot frees" is pinned under the default policy in
  // heartbeat-agent-concurrency-default.test.ts (TON-3195); this suite only covers
  // the database-level invariant and the claim path's unique-violation handling.
});
