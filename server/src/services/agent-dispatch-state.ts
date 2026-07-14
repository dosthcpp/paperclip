import { and, eq, notInArray } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import { DIRECT_NON_INVOKABLE_STATUSES } from "./agent-invokability.js";

/**
 * Flip an agent to "running" at execution-start.
 *
 * Pause Durability: the conditional UPDATE is the sole gate (no read-then-write).
 * Agents in DIRECT_NON_INVOKABLE_STATUSES (paused / terminated / pending_approval)
 * are excluded, so a hard-billing pause -- and the `errorReason` explaining it --
 * survives untouched. 0 rows => caller aborts the run.
 *
 * `errorReason` is cleared on the way in because it records why the agent is *in*
 * error; once it leaves error the text is stale. The watchdog (TON-3267) reads this
 * field to decide whether an agent is sick, so a stale reason on a healthy running
 * agent is reported as a live incident (TON-3281). Clearing loses no history: the
 * failing run row keeps `error` / `errorCode`.
 *
 * Invariant, with the run-finalize clear in `heartbeat.ts`:
 *   errorReason != null  <=>  status in { error, paused }
 */
export async function markAgentRunningForDispatch(db: Db, agentId: string) {
  return db
    .update(agents)
    .set({ status: "running", errorReason: null, updatedAt: new Date() })
    .where(
      and(eq(agents.id, agentId), notInArray(agents.status, [...DIRECT_NON_INVOKABLE_STATUSES])),
    )
    .returning()
    .then((rows) => rows[0] ?? null);
}
