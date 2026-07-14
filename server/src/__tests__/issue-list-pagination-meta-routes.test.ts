import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

/**
 * Regression tests for TON-3263: the issue list API silently truncated at
 * ISSUE_LIST_MAX_LIMIT (1000) rows — no error, no `total`, no `hasMore` — so a
 * board with >1000 issues ran triage on an invisibly cut view for six weeks
 * (TON-3262). These tests seed 1,050 issues (more than the server max) and
 * assert the truncation is now observable three ways:
 *
 *   1. Every list response carries X-Total-Count / X-Has-More / X-Next-Offset.
 *   2. A requested limit above the max is clamped WITH an explicit signal
 *      (X-List-Limit-Clamped), never silently.
 *   3. `?includeMeta=true` returns an envelope with `total`, `hasMore`,
 *      `nextOffset`, and `limitClamped` in the body.
 *
 * If someone "fixes" a future truncation by raising the cap instead of keeping
 * the metadata honest, these assertions fail.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list pagination tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const TOTAL_ISSUES = 1050;
const DONE_ISSUES = 10;
const SERVER_MAX = 1000;
const DEFAULT_LIMIT = 500;

describeEmbeddedPostgres("issue list pagination metadata (TON-3263)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID();
  let app!: express.Express;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-list-pagination-");
    db = createDb(tempDb.connectionString);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "cloud-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: "cloud-user-1",
      membershipRole: "owner",
      grantedByUserId: null,
    });

    const rows = Array.from({ length: TOTAL_ISSUES }, (_, index) => ({
      id: randomUUID(),
      companyId,
      title: `Issue ${index + 1}`,
      status: index < DONE_ISSUES ? "done" : "todo",
      priority: "medium",
    }));
    for (let start = 0; start < rows.length; start += 500) {
      await db.insert(issues).values(rows.slice(start, start + 500));
    }

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "cloud-user-1",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("clamps limit=5000 to the server max but says so instead of truncating silently (CEO repro)", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ limit: "5000" });

    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(SERVER_MAX);
    expect(res.headers["x-list-limit-clamped"]).toBe("true");
    expect(res.headers["x-list-limit"]).toBe(String(SERVER_MAX));
    expect(res.headers["x-list-max-limit"]).toBe(String(SERVER_MAX));
    expect(res.headers["x-total-count"]).toBe(String(TOTAL_ISSUES));
    expect(res.headers["x-has-more"]).toBe("true");
    expect(res.headers["x-next-offset"]).toBe(String(SERVER_MAX));
  });

  it("returns total/hasMore/nextOffset in the body with includeMeta=true", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ limit: "5000", includeMeta: "true" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(SERVER_MAX);
    expect(res.body.total).toBe(TOTAL_ISSUES);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextOffset).toBe(SERVER_MAX);
    expect(res.body.limit).toBe(SERVER_MAX);
    expect(res.body.maxLimit).toBe(SERVER_MAX);
    expect(res.body.requestedLimit).toBe(5000);
    expect(res.body.limitClamped).toBe(true);
  });

  it("walks pagination to a consistent end: last page has hasMore=false and counts add up", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ limit: String(SERVER_MAX), offset: String(SERVER_MAX), includeMeta: "true" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(TOTAL_ISSUES - SERVER_MAX);
    expect(res.body.total).toBe(TOTAL_ISSUES);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextOffset).toBeNull();
    expect(res.body.limitClamped).toBe(false);
  });

  it("keeps the default response an array (backward compatible) while headers carry the truth", async () => {
    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(DEFAULT_LIMIT);
    expect(res.headers["x-has-more"]).toBe("true");
    expect(res.headers["x-total-count"]).toBe(String(TOTAL_ISSUES));
    expect(res.headers["x-next-offset"]).toBe(String(DEFAULT_LIMIT));
    expect(res.headers["x-list-limit-clamped"]).toBeUndefined();
  });

  it("applies filters to total: status=done counts only matching issues", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ status: "done", includeMeta: "true" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(DONE_ISSUES);
    expect(res.body.total).toBe(DONE_ISSUES);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextOffset).toBeNull();
  });

  it("rejects a malformed includeMeta instead of guessing", async () => {
    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ includeMeta: "bogus" });

    expect(res.status).toBe(400);
  });
});
