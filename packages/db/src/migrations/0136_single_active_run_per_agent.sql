-- TON-3196: enforce at most one running heartbeat run per agent at the database level.
-- Concurrent runs of a single agent share one workspace/session and have raced on the
-- same production files (TON-3194: two live runs of one agent independently deployed
-- over each other). Application-level slot checks are read-then-act and cannot stop
-- millisecond-window races, so the invariant lives in a partial unique index.
-- First demote every duplicate currently-running row, keeping the liveliest run per
-- agent (most recent output, then most recent start).
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "agent_id"
      ORDER BY "last_output_at" DESC NULLS LAST, "started_at" DESC NULLS LAST, "created_at" DESC
    ) AS "rn"
  FROM "heartbeat_runs"
  WHERE "status" = 'running'
)
UPDATE "heartbeat_runs" AS hr
SET
  "status" = 'failed',
  "error" = 'Demoted duplicate concurrent run while enforcing one active run per agent (TON-3196)',
  "error_code" = 'duplicate_active_run_demoted',
  "finished_at" = now(),
  "updated_at" = now()
FROM ranked
WHERE hr."id" = ranked."id"
  AND ranked."rn" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_runs_agent_single_running_uidx"
  ON "heartbeat_runs" ("agent_id")
  WHERE "status" = 'running';
