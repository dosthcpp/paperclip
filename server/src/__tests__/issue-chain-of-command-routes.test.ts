import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, heartbeatRuns, issues, projects } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;
type Fixture = Awaited<ReturnType<typeof seedChainOfCommandFixture>>;

function agentActor(fixture: Fixture, agentId: string, runId: string): Express.Request["actor"] {
  return { type: "agent", agentId, companyId: fixture.company.id, runId, source: "agent_jwt" };
}

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use(errorHandler);
  return app;
}

async function seedChainOfCommandFixture(db: Db) {
  const nonce = randomUUID().slice(0, 8);
  const [company] = await db.insert(companies).values({
    name: `Chain of command ${nonce}`,
    issuePrefix: `CC${nonce.slice(0, 4).toUpperCase()}`,
    defaultResponsibleUserId: "board-user",
  }).returning();
  const [project] = await db.insert(projects).values({
    companyId: company!.id,
    name: `Chain ${nonce}`,
    status: "in_progress",
  }).returning();

  const agentRow = (name: string, role: string, reportsTo: string | null) => ({
    companyId: company!.id,
    name,
    role,
    reportsTo,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });

  const [ceo] = await db.insert(agents).values(agentRow("CEO", "ceo", null)).returning();
  const [cto] = await db.insert(agents).values(agentRow("CTO", "cto", ceo!.id)).returning();
  const [engineer] = await db.insert(agents).values(agentRow("Engineer", "engineer", cto!.id)).returning();
  // Reports to the CEO as well, so it is the CTO's peer — never its supervisor.
  const [peer] = await db.insert(agents).values(agentRow("Peer Lead", "coach", ceo!.id)).returning();

  const issueRow = (title: string, assigneeAgentId: string) => ({
    companyId: company!.id,
    projectId: project!.id,
    title,
    status: "in_progress",
    priority: "high",
    assigneeAgentId,
    responsibleUserId: "board-user",
  });

  const [ctoIssue] = await db.insert(issues).values(issueRow("CTO-owned anchor", cto!.id)).returning();
  const [engineerIssue] = await db.insert(issues).values(issueRow("Engineer-owned task", engineer!.id)).returning();

  const runFor = async (agentId: string, issueId: string) => {
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company!.id,
      agentId,
      status: "running",
      contextSnapshot: { issueId },
    }).returning();
    return run!;
  };
  const ceoRun = await runFor(ceo!.id, ctoIssue!.id);
  const ctoRun = await runFor(cto!.id, ctoIssue!.id);
  const peerRun = await runFor(peer!.id, ctoIssue!.id);

  // The CTO holds the live checkout on its own issue — the exact state the CEO
  // was locked out of in TON-3102.
  await db.update(issues)
    .set({ checkoutRunId: ctoRun.id, executionRunId: ctoRun.id })
    .where(eq(issues.id, ctoIssue!.id));

  return {
    company: company!,
    agents: { ceo: ceo!, cto: cto!, engineer: engineer!, peer: peer! },
    issues: { ctoIssue: ctoIssue!, engineerIssue: engineerIssue! },
    runs: { ceo: ceoRun, cto: ctoRun, peer: peerRun },
  };
}

// Each test seeds its own company, so there is no between-test teardown: posting a comment
// fires a fire-and-forget agent wake that keeps inserting rows (heartbeat_runs,
// execution_workspaces, company_skills) after the request returns, and any delete sweep races
// it into foreign-key failures. The temp database is dropped wholesale in afterAll instead.
describeEmbeddedPostgres("chain-of-command issue write boundary (TON-3102)", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-chain-of-command-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lets a supervisor comment on and correct an issue owned by a direct report", async () => {
    const fixture = await seedChainOfCommandFixture(db);
    const app = createApp(db, agentActor(fixture, fixture.agents.ceo.id, fixture.runs.ceo.id));

    const comment = await request(app)
      .post(`/api/issues/${fixture.issues.ctoIssue.id}/comments`)
      .send({ body: "Approved for deployment. Ship it." });
    expect(comment.status, JSON.stringify(comment.body)).toBe(201);
    expect(comment.body).toMatchObject({
      issueId: fixture.issues.ctoIssue.id,
      authorAgentId: fixture.agents.ceo.id,
    });

    const patch = await request(app)
      .patch(`/api/issues/${fixture.issues.ctoIssue.id}`)
      .send({ status: "todo" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body).toMatchObject({ id: fixture.issues.ctoIssue.id, status: "todo" });
  });

  it("extends supervision through a transitive reporting chain", async () => {
    const fixture = await seedChainOfCommandFixture(db);
    const app = createApp(db, agentActor(fixture, fixture.agents.ceo.id, fixture.runs.ceo.id));

    const comment = await request(app)
      .post(`/api/issues/${fixture.issues.engineerIssue.id}/comments`)
      .send({ body: "Skip-level check-in from the CEO." });
    expect(comment.status, JSON.stringify(comment.body)).toBe(201);
  });

  it("keeps an agent outside the reporting chain locked out", async () => {
    const fixture = await seedChainOfCommandFixture(db);
    const app = createApp(db, agentActor(fixture, fixture.agents.peer.id, fixture.runs.peer.id));

    const comment = await request(app)
      .post(`/api/issues/${fixture.issues.ctoIssue.id}/comments`)
      .send({ body: "Peer agent should not reach this issue." });
    expect(comment.status, JSON.stringify(comment.body)).toBe(403);
    expect(comment.body.error).toBe("Issue is outside this actor's authorization boundary");

    const patch = await request(app)
      .patch(`/api/issues/${fixture.issues.ctoIssue.id}`)
      .send({ status: "todo" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(403);
    expect(patch.body.error).toBe("Issue is outside this actor's authorization boundary");
  });
});
