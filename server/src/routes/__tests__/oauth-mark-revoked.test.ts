import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { oauthMarkRevokedRoute } from "../oauth-mark-revoked.js";

interface MakeAppOptions {
  allowedIds: string[];
  injectClaim?: boolean; // default true; set false to simulate missing JWT
}

function makeApp({ allowedIds, injectClaim = true }: MakeAppOptions) {
  const updateMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn().mockReturnValue({ where: () => updateMock() });
  const db = {
    update: vi.fn().mockReturnValue({ set: setMock }),
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/oauth/connections/:id/mark-revoked",
    (req, _res, next) => {
      if (injectClaim) {
        (req as unknown as { runJwt: unknown }).runJwt = {
          connectionIds: allowedIds,
          runId: "r1",
        };
      }
      next();
    },
    oauthMarkRevokedRoute({ db } as never),
  );
  return { app, updateMock, setMock, db };
}

describe("POST /api/oauth/connections/:id/mark-revoked", () => {
  it("204 when JWT scopes the connection", async () => {
    const { app, updateMock, setMock } = makeApp({ allowedIds: ["c-1"] });
    const res = await request(app).post("/api/oauth/connections/c-1/mark-revoked");
    expect(res.status).toBe(204);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revoked",
        lastError: "runtime_401",
      }),
    );
  });

  it("403 when JWT does not include the connection", async () => {
    const { app, updateMock } = makeApp({ allowedIds: ["other"] });
    const res = await request(app).post("/api/oauth/connections/c-1/mark-revoked");
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("forbidden");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("401 when no run-JWT claim is present on the request", async () => {
    const { app, updateMock } = makeApp({
      allowedIds: ["c-1"],
      injectClaim: false,
    });
    const res = await request(app).post("/api/oauth/connections/c-1/mark-revoked");
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("unauthenticated");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
