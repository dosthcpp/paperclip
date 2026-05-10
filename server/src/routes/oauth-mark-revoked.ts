import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { oauthConnections } from "@paperclipai/db/schema/oauth";

export interface MarkRevokedDeps {
  // db: Drizzle handle. Kept loose so this route does not pull the full Db
  // type into the module; wired up in app.ts (T28) with the real instance.
  db: any;
}

interface RunJwtClaim {
  connectionIds?: unknown;
  runId?: unknown;
}

// The run-JWT middleware (M2 in the plan) attaches `req.runJwt` with the OAuth
// connection IDs scoped to this run. Until that middleware lands the field is
// not on Express.Request globally — we read it via a local cast and tests
// inject it directly. No global type augmentation here on purpose.
export function oauthMarkRevokedRoute(deps: MarkRevokedDeps): RequestHandler {
  const r = Router({ mergeParams: true });
  r.post("/", async (req, res) => {
    const claim = (req as unknown as { runJwt?: RunJwtClaim }).runJwt;
    if (!claim) {
      res.status(401).json({ errorCode: "unauthenticated" });
      return;
    }
    const allowed: string[] = Array.isArray(claim.connectionIds)
      ? claim.connectionIds.filter((x): x is string => typeof x === "string")
      : [];
    const id = (req.params as { id?: string }).id ?? "";
    if (!allowed.includes(id)) {
      res.status(403).json({ errorCode: "forbidden" });
      return;
    }
    await deps.db
      .update(oauthConnections)
      .set({
        status: "revoked",
        lastError: "runtime_401",
        lastErrorAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, id));
    res.status(204).end();
  });
  return r;
}
