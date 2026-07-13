-- TON-3196: enforce at most one running heartbeat run per agent at the database level.
-- Concurrent runs of a single agent share one workspace/session and have raced on the
-- same production files (TON-3194: two live runs of one agent independently deployed
-- over each other). Application-level slot checks are read-then-act and cannot stop
-- millisecond-window races, so the invariant lives in a partial unique index.
-- Do not rewrite live rows here. A running row may still have an OS/remote adapter,
-- claimed wake request, issue execution lock, and environment lease attached to it.
-- Demoting only the heartbeat row would let a new run start while the old process is
-- still mutating its workspace, and the late process finalizer could no longer release
-- its linked lifecycle state. Rollout must quiesce dispatch and drain/terminate every
-- adapter through the normal finalization path before this migration is applied.
DO $$
DECLARE
  live_run_count integer;
BEGIN
  SELECT count(*)::integer
  INTO live_run_count
  FROM "heartbeat_runs"
  WHERE "status" = 'running';

  IF live_run_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55006',
      MESSAGE = format(
        'Cannot enforce one active run per agent while %s heartbeat run(s) are still running',
        live_run_count
      ),
      HINT = 'Quiesce scheduler dispatch, drain or terminate adapters, and wait for wake requests, issue execution locks, and environment/runtime leases to finalize before retrying migration 0136.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_runs_agent_single_running_uidx"
  ON "heartbeat_runs" ("agent_id")
  WHERE "status" = 'running';
