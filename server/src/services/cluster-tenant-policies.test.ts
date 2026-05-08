import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEmbeddedPostgresTestDatabase, type EmbeddedPostgresTestDatabase, createDb } from "@paperclipai/db";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { clusterTenantPoliciesService } from "./cluster-tenant-policies.js";

let dbHandle: EmbeddedPostgresTestDatabase;
let db: Db;
let clusterId: string;
let companyId: string;

beforeAll(async () => {
  dbHandle = await startEmbeddedPostgresTestDatabase("paperclip-tenant-pol-test-");
  db = createDb(dbHandle.connectionString);

  // Seed a cluster connection and a company.
  const clusterRows = await db.execute(sql`
    INSERT INTO cluster_connections (label, kind, capabilities, created_by)
    VALUES ('seed-cluster', 'in-cluster', '{"cilium":false,"storageClass":"standard","architectures":["amd64"]}'::jsonb, 'sys')
    RETURNING id
  `);
  clusterId = (clusterRows.rows?.[0] as { id: string } | undefined)?.id ?? (clusterRows[0] as { id: string }).id;

  // companies has: id (uuid, defaultRandom), name (text notNull), and everything else defaults.
  const companyRows = await db.execute(sql`
    INSERT INTO companies (name)
    VALUES ('Acme')
    RETURNING id
  `);
  companyId = (companyRows.rows?.[0] as { id: string } | undefined)?.id ?? (companyRows[0] as { id: string }).id;
});
afterAll(async () => { await dbHandle.cleanup(); });

describe("clusterTenantPoliciesService", () => {
  it("get() returns null when no policy exists", async () => {
    const svc = clusterTenantPoliciesService(db);
    const result = await svc.get(clusterId, companyId);
    expect(result).toBeNull();
  });

  it("upsert() creates a row, then a second upsert updates it", async () => {
    const svc = clusterTenantPoliciesService(db);
    const created = await svc.upsert({
      clusterConnectionId: clusterId,
      companyId,
      quota: { requestsCpu: "32" },
      limitRange: null,
      additionalAllowFqdns: ["api.acme.io"],
      imageOverrides: null,
    });
    expect(created.quota?.requestsCpu).toBe("32");
    expect(created.additionalAllowFqdns).toEqual(["api.acme.io"]);

    const updated = await svc.upsert({
      clusterConnectionId: clusterId,
      companyId,
      quota: { requestsCpu: "64", countJobs: 200 },
      limitRange: { default: { cpu: "2" } },
      additionalAllowFqdns: ["api.acme.io", "*.linear.app"],
      imageOverrides: { claude_local: "ecr.acme.io/agent-runtime-claude:v1" },
    });
    expect(updated.quota?.requestsCpu).toBe("64");
    expect(updated.quota?.countJobs).toBe(200);
    expect(updated.additionalAllowFqdns).toEqual(["api.acme.io", "*.linear.app"]);
    expect(updated.imageOverrides?.claude_local).toBe("ecr.acme.io/agent-runtime-claude:v1");
  });

  it("get() reads back what upsert wrote", async () => {
    const svc = clusterTenantPoliciesService(db);
    const fetched = await svc.get(clusterId, companyId);
    expect(fetched).not.toBeNull();
    expect(fetched?.additionalAllowFqdns).toEqual(["api.acme.io", "*.linear.app"]);
    expect(fetched?.limitRange?.default?.cpu).toBe("2");
  });
});
