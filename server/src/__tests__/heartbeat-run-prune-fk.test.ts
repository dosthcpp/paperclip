import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentTaskSessions,
  agents,
  companies,
  costEvents,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("heartbeat run pruning vs run-stamped FKs (#7450)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-prune-fk-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("deleting a heartbeat run nulls cost/activity/session stamps and cascades run events", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Prune Co",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Pruned Runner",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "succeeded",
    });

    const costEventId = randomUUID();
    await db.insert(costEvents).values({
      id: costEventId,
      companyId,
      agentId,
      heartbeatRunId: runId,
      provider: "anthropic",
      model: "claude-test",
      costCents: 0,
      occurredAt: new Date(),
    });
    const activityId = randomUUID();
    await db.insert(activityLog).values({
      id: activityId,
      companyId,
      runId,
      actorType: "agent",
      actorId: agentId,
      action: "test.action",
      entityType: "issue",
      entityId: randomUUID(),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: 1,
      eventType: "lifecycle",
    });
    const sessionId = randomUUID();
    await db.insert(agentTaskSessions).values({
      id: sessionId,
      companyId,
      agentId,
      adapterType: "codex_local",
      taskKey: "task-1",
      lastRunId: runId,
    });

    // The pruning delete used to throw FK violations (e.g. cost_events_heartbeat_run_id_…_fk).
    await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, runId));

    const [cost] = await db.select().from(costEvents).where(eq(costEvents.id, costEventId));
    expect(cost?.heartbeatRunId).toBeNull();
    const [activity] = await db.select().from(activityLog).where(eq(activityLog.id, activityId));
    expect(activity?.runId).toBeNull();
    const [session] = await db.select().from(agentTaskSessions).where(eq(agentTaskSessions.id, sessionId));
    expect(session?.lastRunId).toBeNull();
    const events = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, runId));
    expect(events).toHaveLength(0);
  });
});
