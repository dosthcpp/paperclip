-- TON-3201: replace the emergency one-running-run-per-agent guard with two
-- database-enforced invariants:
--   1. one running writer per mutable workspace/session scope; and
--   2. one non-isolated running run per agent.
-- Distinct, explicitly isolated scopes may run concurrently up to the agent's
-- configured maxConcurrentRuns, which is enforced under an agent-row lock.
ALTER TABLE "heartbeat_runs"
  ADD COLUMN IF NOT EXISTS "concurrency_scope_key" text,
  ADD COLUMN IF NOT EXISTS "concurrency_session_key" text,
  ADD COLUMN IF NOT EXISTS "concurrency_isolated" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Migration 0136 guarantees at most one running row per agent, so this bounded
-- backfill cannot introduce a collision. Existing live runs stay serialized
-- until their next claim is classified by the new service code.
UPDATE "heartbeat_runs"
SET
  "concurrency_scope_key" = 'agent-fallback:' || "agent_id"::text,
  "concurrency_isolated" = false
WHERE "status" = 'running'
  AND "concurrency_scope_key" IS NULL;
--> statement-breakpoint
-- Compatibility and fail-safe guard for recovery/admin code that promotes a row
-- directly to running without classifying it first. Such rows are never treated
-- as isolated; the database assigns the conservative per-agent fallback scope.
CREATE OR REPLACE FUNCTION heartbeat_runs_apply_fallback_concurrency_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'running' AND NEW."concurrency_scope_key" IS NULL THEN
    NEW."concurrency_scope_key" := 'agent-fallback:' || NEW."agent_id"::text;
    NEW."concurrency_session_key" := NULL;
    NEW."concurrency_isolated" := false;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "heartbeat_runs_fallback_concurrency_scope_trg" ON "heartbeat_runs";
--> statement-breakpoint
CREATE TRIGGER "heartbeat_runs_fallback_concurrency_scope_trg"
BEFORE INSERT OR UPDATE OF "status", "concurrency_scope_key", "concurrency_isolated"
ON "heartbeat_runs"
FOR EACH ROW
EXECUTE FUNCTION heartbeat_runs_apply_fallback_concurrency_scope();
--> statement-breakpoint
ALTER TABLE "heartbeat_runs"
  DROP CONSTRAINT IF EXISTS "heartbeat_runs_running_scope_required_check";
--> statement-breakpoint
ALTER TABLE "heartbeat_runs"
  ADD CONSTRAINT "heartbeat_runs_running_scope_required_check"
  CHECK (
    "status" <> 'running'
    OR (
      "concurrency_scope_key" IS NOT NULL
      AND ("concurrency_isolated" = false OR "concurrency_session_key" IS NOT NULL)
    )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_runs_running_workspace_scope_uidx"
  ON "heartbeat_runs" ("concurrency_scope_key")
  WHERE "status" = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_runs_running_serial_agent_uidx"
  ON "heartbeat_runs" ("agent_id")
  WHERE "status" = 'running' AND "concurrency_isolated" = false;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_runs_running_isolated_session_uidx"
  ON "heartbeat_runs" ("agent_id", "concurrency_session_key")
  WHERE "status" = 'running' AND "concurrency_isolated" = true;
--> statement-breakpoint
DROP INDEX IF EXISTS "heartbeat_runs_agent_single_running_uidx";
