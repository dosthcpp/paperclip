import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentRuntimeState,
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
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

describeEmbeddedPostgres("heartbeat single running run per agent (TON-3196)", () => {
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
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
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
      contextSnapshot: { wakeReason: "test-assignment-wake" },
      ...(input.status === "running" ? { startedAt: new Date() } : {}),
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
    return { runId, wakeupRequestId };
  }

  it("rejects a second concurrently running row for the same agent at the database level", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await seedRun({ companyId, agentId, status: "running" });

    const error = await seedRun({ companyId, agentId, status: "running" }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeTruthy();
    // Drizzle wraps the postgres error, so the constraint name lives on the cause chain.
    const chain: string[] = [];
    for (let cursor = error; cursor && typeof cursor === "object"; cursor = (cursor as { cause?: unknown }).cause) {
      chain.push(String((cursor as { message?: unknown }).message ?? cursor));
    }
    expect(chain.join(" | ")).toContain("heartbeat_runs_agent_single_running_uidx");
  });

  it("keeps queued runs queued when the app-level slot check would allow a duplicate start", async () => {
    // maxConcurrentRuns=5 deliberately re-opens the application-level race window
    // (availableSlots > 0 while a run is live) so this pins the DB constraint plus
    // the claim path's graceful unique-violation handling, not the slot arithmetic.
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
