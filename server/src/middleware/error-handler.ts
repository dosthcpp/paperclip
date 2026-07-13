import type { Request, Response, NextFunction } from "express";
import type { Db } from "@paperclipai/db";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
import { trackErrorHandlerCrash } from "@paperclipai/shared/telemetry";
import { getTelemetryClient } from "../telemetry.js";
import { COMPANY_IMPORT_API_PATH } from "../routes/company-import-paths.js";
import { logger } from "./logger.js";
import {
  recordResponsibleUserDenialOnActiveRun,
} from "../services/responsible-user-denial-run-outcomes.js";

export interface ErrorContext {
  error: { message: string; stack?: string; name?: string; details?: unknown; raw?: unknown };
  method: string;
  url: string;
  reqBody?: unknown;
  reqParams?: unknown;
  reqQuery?: unknown;
}

function attachErrorContext(
  req: Request,
  res: Response,
  payload: ErrorContext["error"],
  rawError?: Error,
) {
  (res as any).__errorContext = {
    error: payload,
    method: req.method,
    url: req.originalUrl,
    reqBody: req.body,
    reqParams: req.params,
    reqQuery: req.query,
  } satisfies ErrorContext;
  if (rawError) {
    (res as any).err = rawError;
  }
}

function getPaperclipDb(req: Request): Db | null {
  const locals = req.app?.locals as { paperclipDb?: Db; db?: Db } | undefined;
  return locals?.paperclipDb ?? locals?.db ?? null;
}

function recordResponsibleUserDenialFromHttpError(
  req: Request,
  details: Record<string, unknown> | null,
) {
  if (req.actor?.type !== "agent") return;
  const db = getPaperclipDb(req);
  if (!db) return;

  void recordResponsibleUserDenialOnActiveRun(db, {
    runId: req.actor.runId ?? null,
    agentId: req.actor.agentId ?? null,
    companyId: req.actor.companyId ?? null,
    code: details?.code,
  }).catch((recordErr) => {
    logger.warn(
      {
        err: recordErr,
        runId: req.actor?.runId ?? null,
        agentId: req.actor?.type === "agent" ? req.actor.agentId ?? null : null,
      },
      "failed to record responsible-user denial on heartbeat run",
    );
  });
}

/**
 * Recognise a request-validation failure without relying on class identity.
 *
 * `instanceof ZodError` only holds when the throwing schema was built by the
 * *same* zod module instance this file imports. Release bundles install a
 * separate physical copy of zod under `@paperclipai/shared` and another under
 * `@paperclipai/server`, so every schema defined in `shared` (which is most of
 * them) throws a ZodError the server's `instanceof` cannot see. The result was
 * silent: a malformed or empty request body fell through to the generic branch
 * and was reported as `500 Internal server error` instead of `400 Validation
 * error`, telling callers the server was broken when their payload was.
 *
 * Match structurally so any zod copy — v3 (`.errors`) or v4 (`.issues`) — maps
 * to a 400.
 */
function zodValidationIssues(err: unknown): unknown[] | null {
  if (err instanceof ZodError) return err.errors;
  if (!(err instanceof Error) || err.name !== "ZodError") return null;
  const candidate = err as unknown as { issues?: unknown; errors?: unknown };
  const issues = candidate.issues ?? candidate.errors;
  return Array.isArray(issues) ? issues : null;
}

/**
 * Recognise a body-parser (http-errors family) client error, e.g. malformed
 * JSON (`entity.parse.failed`), oversized payload (`entity.too.large`) or an
 * unsupported charset. These are thrown by `express.json()`, which is mounted
 * *before* `httpLogger`, so the request never reaches pino-http: the error
 * used to fall through to the generic branch and surface as an **unlogged
 * 500** — a client-side bug (e.g. a truncated JSON string) dressed up as a
 * platform outage with zero log evidence (TON-3141/TON-3142).
 */
function bodyParserClientError(
  err: unknown,
): { status: number; type: string; message: string; bodyPreview: string | null } | null {
  if (!(err instanceof Error)) return null;
  const candidate = err as unknown as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
    body?: unknown;
  };
  const status = typeof candidate.status === "number"
    ? candidate.status
    : typeof candidate.statusCode === "number"
      ? candidate.statusCode
      : null;
  if (status === null || status < 400 || status >= 500) return null;
  if (typeof candidate.type !== "string" || candidate.type.length === 0) return null;
  const bodyPreview = typeof candidate.body === "string"
    ? candidate.body.slice(0, 200)
    : null;
  return { status, type: candidate.type, message: err.message, bodyPreview };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    const details = err.details && typeof err.details === "object" && !Array.isArray(err.details)
      ? err.details as Record<string, unknown>
      : null;
    recordResponsibleUserDenialFromHttpError(req, details);
    if (err.status >= 500) {
      attachErrorContext(
        req,
        res,
        { message: err.message, stack: err.stack, name: err.name, details: err.details },
        err,
      );
      const tc = getTelemetryClient();
      if (tc) trackErrorHandlerCrash(tc, { errorCode: err.name });
    }
    res.status(err.status).json({
      error: err.message,
      ...(typeof details?.code === "string" ? { code: details.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const bodyErr = bodyParserClientError(err);
  if (bodyErr) {
    // pino-http never saw this request (parse failed before httpLogger ran),
    // so this WARN is the only log line the request will ever get.
    logger.warn(
      {
        method: req.method,
        url: req.originalUrl,
        status: bodyErr.status,
        type: bodyErr.type,
        ...(bodyErr.bodyPreview !== null ? { bodyPreview: bodyErr.bodyPreview } : {}),
      },
      `${req.method} ${req.originalUrl} ${bodyErr.status} — ${bodyErr.type}: ${bodyErr.message}`,
    );
    res.status(bodyErr.status).json({
      error: "Invalid request body",
      code: bodyErr.type,
      details: { message: bodyErr.message },
    });
    return;
  }

  const zodIssues = zodValidationIssues(err);
  if (zodIssues) {
    res.status(400).json({ error: "Validation error", details: zodIssues });
    return;
  }

  const rootError = err instanceof Error ? err : new Error(String(err));
  attachErrorContext(
    req,
    res,
    err instanceof Error
      ? { message: err.message, stack: err.stack, name: err.name }
      : { message: String(err), raw: err, stack: rootError.stack, name: rootError.name },
    rootError,
  );

  const tc = getTelemetryClient();
  if (tc) trackErrorHandlerCrash(tc, { errorCode: rootError.name });

  res.status(500).json({
    error: "Internal server error",
    ...(shouldExposeTrustedCloudTenantImportError(req) ? { message: rootError.message } : {}),
  });
}

function shouldExposeTrustedCloudTenantImportError(req: Request) {
  return req.actor?.source === "cloud_tenant"
    && req.method === "POST"
    && req.originalUrl.split("?")[0] === COMPANY_IMPORT_API_PATH;
}
