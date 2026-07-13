import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/error-handler.js";

const recordResponsibleUserDenialOnActiveRunMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("../services/responsible-user-denial-run-outcomes.js", () => ({
  recordResponsibleUserDenialOnActiveRun: recordResponsibleUserDenialOnActiveRunMock,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: loggerWarnMock,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  httpLogger: vi.fn(),
}));

function makeReq(): Request {
  return {
    method: "GET",
    originalUrl: "/api/test",
    body: { a: 1 },
    params: { id: "123" },
    query: { q: "x" },
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

describe("errorHandler", () => {
  beforeEach(() => {
    recordResponsibleUserDenialOnActiveRunMock.mockReset();
    recordResponsibleUserDenialOnActiveRunMock.mockResolvedValue(null);
  });

  it("attaches the original Error to res.err for 500s", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("boom");

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(res.err).toBe(err);
    expect(res.__errorContext?.error?.message).toBe("boom");
  });

  it("exposes raw 500 messages for trusted Cloud tenant imports", () => {
    const req = {
      ...makeReq(),
      method: "POST",
      originalUrl: "/api/companies/import",
      actor: {
        type: "board",
        userId: "cloud-user",
        source: "cloud_tenant",
      },
    } as unknown as Request;
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("portable file references missing upload id");

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal server error",
      message: "portable file references missing upload id",
    });
    expect(res.err).toBe(err);
  });

  it("attaches HttpError instances for 500 responses", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new HttpError(500, "db exploded");

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "db exploded" });
    expect(res.err).toBe(err);
    expect(res.__errorContext?.error?.message).toBe("db exploded");
  });

  it("records responsible-user denial codes on the active agent run", () => {
    const db = { marker: "db" };
    const req = {
      ...makeReq(),
      app: { locals: { paperclipDb: db } },
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
        source: "agent_jwt",
      },
    } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    const err = new HttpError(403, "Responsible user is not authorized", {
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
    });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Responsible user is not authorized",
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
      details: { code: "RESPONSIBLE_USER_UNAUTHORIZED" },
    });
    expect(recordResponsibleUserDenialOnActiveRunMock).toHaveBeenCalledWith(db, {
      runId: "run-1",
      agentId: "agent-1",
      companyId: "company-1",
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
    });
  });
});

// TON-3096: release bundles install a physically separate copy of zod under
// @paperclipai/shared, so schemas defined there throw a ZodError whose class is
// NOT the one this module imports. `instanceof` missed it and every validation
// failure surfaced as 500 "Internal server error" — which is why an empty
// comment body read as a platform outage and stranded a finished manuscript.
describe("errorHandler — ZodError from a duplicate zod install", () => {
  beforeEach(() => {
    recordResponsibleUserDenialOnActiveRunMock.mockReset();
    recordResponsibleUserDenialOnActiveRunMock.mockResolvedValue(null);
  });

  /** A ZodError class identity the server's `instanceof` cannot see. */
  class ForeignZodError extends Error {
    issues: unknown[];
    errors: unknown[];
    constructor(issues: unknown[]) {
      super(JSON.stringify(issues));
      this.name = "ZodError";
      this.issues = issues;
      this.errors = issues;
    }
  }

  const missingBodyIssue = {
    code: "invalid_type",
    expected: "string",
    received: "undefined",
    path: ["body"],
    message: "Required",
  };

  it("returns 400 for a foreign ZodError exposing .issues (zod v4 shape)", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new ForeignZodError([missingBodyIssue]);
    delete (err as Partial<ForeignZodError>).errors;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Validation error",
      details: [missingBodyIssue],
    });
  });

  it("returns 400 for a foreign ZodError exposing .errors (zod v3 shape)", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new ForeignZodError([missingBodyIssue]);
    delete (err as Partial<ForeignZodError>).issues;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Validation error",
      details: [missingBodyIssue],
    });
  });

  it("still returns 500 for a genuine server error", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("connection terminated unexpectedly");
    err.name = "PostgresError";

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("does not mistake a non-zod error that merely lacks issues for validation", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("weird");
    err.name = "ZodError";

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// TON-3142: express.json() is mounted before httpLogger, so a malformed JSON
// body throws entity.parse.failed before pino-http ever attaches — the request
// surfaced as an UNLOGGED 500, making a truncated client payload look like a
// platform outage with zero log evidence (TON-3141 false P1).
describe("errorHandler — body-parser client errors (TON-3142)", () => {
  beforeEach(() => {
    recordResponsibleUserDenialOnActiveRunMock.mockReset();
    recordResponsibleUserDenialOnActiveRunMock.mockResolvedValue(null);
    loggerWarnMock.mockReset();
  });

  /** What express.json() actually throws on malformed JSON (via http-errors). */
  function makeParseFailure(rawBody: string): SyntaxError {
    const err = new SyntaxError("Unexpected end of JSON input") as SyntaxError & {
      status: number;
      statusCode: number;
      expose: boolean;
      type: string;
      body: string;
    };
    err.status = 400;
    err.statusCode = 400;
    err.expose = true;
    err.type = "entity.parse.failed";
    err.body = rawBody;
    return err;
  }

  it("maps entity.parse.failed to 400 with the parser message", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(makeParseFailure('{"body":"truncat'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid request body",
      code: "entity.parse.failed",
      details: { message: "Unexpected end of JSON input" },
    });
  });

  it("logs a WARN with path and a body preview (the only log line this request gets)", () => {
    const req = { ...makeReq(), method: "POST", originalUrl: "/api/issues/abc/comments" } as unknown as Request;
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(makeParseFailure('{"body":"truncat'), req, res, next);

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const [props, message] = loggerWarnMock.mock.calls[0];
    expect(props).toMatchObject({
      method: "POST",
      url: "/api/issues/abc/comments",
      status: 400,
      type: "entity.parse.failed",
      bodyPreview: '{"body":"truncat',
    });
    expect(message).toBe(
      "POST /api/issues/abc/comments 400 — entity.parse.failed: Unexpected end of JSON input",
    );
  });

  it("truncates the body preview to 200 chars", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(makeParseFailure(`{"body":"${"x".repeat(500)}`), req, res, next);

    const [props] = loggerWarnMock.mock.calls[0];
    expect((props as { bodyPreview: string }).bodyPreview).toHaveLength(200);
  });

  it("keeps the http-errors status for other body-parser failures (413 entity.too.large)", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("request entity too large") as Error & {
      status: number;
      type: string;
    };
    err.status = 413;
    err.type = "entity.too.large";

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid request body",
      code: "entity.too.large",
      details: { message: "request entity too large" },
    });
  });

  it("does not downgrade a 5xx that happens to carry a type", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("stream encoding should not be set") as Error & {
      status: number;
      type: string;
    };
    err.status = 500;
    err.type = "stream.encoding.set";

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("does not treat a plain 4xx-status error without a body-parser type as a client error", () => {
    const req = makeReq();
    const res = makeRes() as any;
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error("some library error") as Error & { status: number };
    err.status = 404;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});
