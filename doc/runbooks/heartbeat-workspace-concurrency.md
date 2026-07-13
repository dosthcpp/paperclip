# Workspace-scoped heartbeat concurrency

This runbook covers the staged rollout and rollback of workspace-scoped agent
concurrency introduced for TON-3201. Do not raise an agent above one concurrent
run until its work is bound to persisted, reusable `isolated_workspace` rows.

## Safety model

- A run is parallel-eligible only when its issue points to an existing,
  non-archived `isolated_workspace`, requests `reuse_existing`, has a stable task
  key, and the workspace has a canonical local path or provider reference.
- Shared, agent-default, missing, stale, or unidentifiable workspaces use the
  per-agent fallback scope and remain serialized.
- PostgreSQL unique indexes allow only one `running` writer per canonical
  workspace and one `running` writer per agent/session key.
- A transaction locks the agent row while recounting active runs and claiming a
  slot, so multiple Paperclip server processes cannot exceed
  `maxConcurrentRuns` through a read-then-write race.
- Before adapter invocation, the realized workspace and task/session key must
  still match the scope frozen at claim time. Drift fails before agent execution.

## Rollout

1. Keep all agents at `maxConcurrentRuns=1` and deploy the application plus
   migration `0137_workspace_scoped_run_concurrency.sql`.
2. Confirm the migration backfilled every existing `running` row as
   non-isolated and created the fallback trigger plus all three partial unique
   indexes.
3. Run the focused heartbeat constraint, dependency scheduling, and
   process-loss recovery suites.
4. Bind each intended parallel issue to a distinct persisted isolated workspace
   and set `executionWorkspacePreference=reuse_existing`.
5. Raise only the CTO to `maxConcurrentRuns=5`. Dispatch five isolated issues
   and verify five distinct non-null scope keys are `running`; a sixth must stay
   queued until a slot is released.
6. Verify a same-workspace run, same-task/session run, and a workspace-less run
   remain queued. Verify `process_lost_retry` reacquires only after its predecessor
   is terminal.

Useful read-only checks:

```sql
SELECT agent_id, count(*)
FROM heartbeat_runs
WHERE status = 'running'
GROUP BY agent_id;

SELECT concurrency_scope_key, count(*)
FROM heartbeat_runs
WHERE status = 'running'
GROUP BY concurrency_scope_key
HAVING count(*) > 1;

SELECT id, agent_id, concurrency_scope_key, concurrency_session_key
FROM heartbeat_runs
WHERE status = 'running'
  AND (concurrency_scope_key IS NULL
    OR (concurrency_isolated AND concurrency_session_key IS NULL));
```

The last two queries must return no rows.

## Rollback

Application rollback alone is safe if migration 0137 remains installed: older
code is conservatively classified by the database trigger and therefore runs at
one active run per agent.

To remove migration 0137, first set every agent to `maxConcurrentRuns=1`, stop
new dispatch, and wait until each agent has at most one `running` row. Then:

1. Recreate `heartbeat_runs_agent_single_running_uidx` on `agent_id` where
   `status='running'`.
2. Deploy the 0136-compatible application.
3. Drop the 0137 scope/session indexes, check constraint, fallback trigger and
   function, then drop its three columns.

Never recreate the 0136 index while an agent has multiple running rows; the DDL
will fail. Do not demote live rows casually during rollback because issue
execution locks, wake requests, leases, and process ownership also require
reconciliation. Draining is the preferred rollback path.
