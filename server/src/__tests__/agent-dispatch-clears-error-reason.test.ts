import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { markAgentRunningForDispatch } from "../services/agent-dispatch-state.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dispatch-state tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/**
 * TON-3281 AC2: an agent that recovers out of `error` must not keep carrying the
 * failure text, because the watchdog reads `errorReason` to decide who is sick.
 * The run-finalize path already cleared it; execution-start did not, so a healthy
 * agent stayed "sick" for the entire duration of its recovery run.
 */
describeEmbeddedPostgres("markAgentRunningForDispatch", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-dispatch-state-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgent(status: string, errorReason: string | null) {
    companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CTO",
      role: "engineer",
      status: status as never,
      errorReason,
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return agentId;
  }

  const read = async (agentId: string) =>
    (await db.select().from(agents).where(eq(agents.id, agentId)))[0];

  it("clears a stale errorReason when a recovering agent is dispatched", async () => {
    // The exact pollution from the incident: a *successful* run's report, stamped
    // into errorReason because the adapter read its own cleanup SIGTERM as failure.
    const agentId = await seedAgent(
      "error",
      "Claude run failed: subtype=success: **TON-3274 is done.** The reported bug was already fixed",
    );

    const dispatched = await markAgentRunningForDispatch(db, agentId);

    expect(dispatched).toMatchObject({ id: agentId, status: "running", errorReason: null });
    expect(await read(agentId)).toMatchObject({ status: "running", errorReason: null });
  });

  it("also clears the reason when the recovered-from failure was genuine", async () => {
    // Process-lost reaper text -- a real failure, but still stale once we re-dispatch.
    const agentId = await seedAgent(
      "error",
      "Process lost -- child pid 55626 is no longer running",
    );

    await markAgentRunningForDispatch(db, agentId);

    expect(await read(agentId)).toMatchObject({ status: "running", errorReason: null });
  });

  it("does NOT touch a billing-paused agent -- pause and reason survive", async () => {
    // The trap: TON-3278/TON-3314 pause the agent on a hard billing wall and put the
    // reason here. If dispatch cleared it, the wall would read as healthy (false green).
    const agentId = await seedAgent("paused", "You're out of usage credits.");

    const dispatched = await markAgentRunningForDispatch(db, agentId);

    expect(dispatched).toBeNull(); // 0 rows => caller aborts the run
    expect(await read(agentId)).toMatchObject({
      status: "paused",
      errorReason: "You're out of usage credits.",
    });
  });

  it("does NOT resurrect terminated or pending_approval agents", async () => {
    for (const status of ["terminated", "pending_approval"] as const) {
      const agentId = await seedAgent(status, "reason retained");
      expect(await markAgentRunningForDispatch(db, agentId)).toBeNull();
      expect(await read(agentId)).toMatchObject({ status, errorReason: "reason retained" });
      await db.delete(agents).where(eq(agents.id, agentId));
    }
  });

  it("dispatches a healthy idle agent unchanged", async () => {
    const agentId = await seedAgent("idle", null);

    const dispatched = await markAgentRunningForDispatch(db, agentId);

    expect(dispatched).toMatchObject({ status: "running", errorReason: null });
  });
});
