import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { updateAgentSchema } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";

/**
 * TON-3278 #2: `PATCH /api/agents/:id` with `{"status":"idle","errorReason":null}`
 * returned 200 but left the stale error string on the record, because
 * `updateAgentSchema` did not declare `errorReason` and zod strips unknown keys
 * — the field never reached the service. An idle agent kept reading as broken.
 */

const STALE_REASON =
  "Claude run failed: subtype=success: You're out of usage credits. Run /usage-credits to keep using Fable 5.";

describe("updateAgentSchema errorReason", () => {
  it("preserves an explicit null instead of silently stripping it", () => {
    const parsed = updateAgentSchema.parse({ status: "idle", errorReason: null });
    expect(parsed).toHaveProperty("errorReason", null);
  });

  it("preserves an explicit string", () => {
    const parsed = updateAgentSchema.parse({ errorReason: "manual note" });
    expect(parsed).toHaveProperty("errorReason", "manual note");
  });

  it("omits the key entirely when the caller does not send it", () => {
    const parsed = updateAgentSchema.parse({ status: "idle" });
    expect(Object.prototype.hasOwnProperty.call(parsed, "errorReason")).toBe(false);
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent errorReason tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent service update errorReason", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-error-reason-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedErroredAgent() {
    const companyId = randomUUID();
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
      status: "error",
      errorReason: STALE_REASON,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return agentId;
  }

  it("clears errorReason when the patch sends an explicit null", async () => {
    const agentId = await seedErroredAgent();

    const updated = await agentService(db).update(agentId, { status: "idle", errorReason: null });

    expect(updated).toMatchObject({ id: agentId, status: "idle", errorReason: null });
  });

  it("keeps errorReason untouched when the patch does not mention it", async () => {
    const agentId = await seedErroredAgent();

    const updated = await agentService(db).update(agentId, { title: "Chief Technical Officer" });

    // The route layer, not the service, applies the "leaving error clears the
    // reason" rule; a patch that touches neither must not lose the diagnostic.
    expect(updated).toMatchObject({ id: agentId, status: "error", errorReason: STALE_REASON });
  });
});
