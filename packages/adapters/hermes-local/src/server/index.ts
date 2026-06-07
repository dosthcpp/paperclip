/**
 * Server surface for the in-tree Hermes Agent adapter (TON-2230, Option B).
 *
 * Phase 2 (TON-2269): the Hermes adapter execution path is now vendored
 * in-tree under `./*` instead of re-exported from the external
 * `hermes-paperclip-adapter` package. The server registry imports these
 * symbols via `@paperclipai/adapter-hermes-local/server`.
 */

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export {
  detectModel,
  parseModelFromConfig,
  resolveProvider,
  inferProviderFromModel,
} from "./detect-model.js";
export {
  listHermesSkills as listSkills,
  syncHermesSkills as syncSkills,
  resolveHermesDesiredSkillNames as resolveDesiredSkillNames,
} from "./skills.js";

import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Session codec for structured validation and migration of session parameters.
 *
 * Hermes Agent uses a single `sessionId` for cross-heartbeat session continuity
 * via the `--resume` CLI flag, plus the `cwd` the session was created in so the
 * next heartbeat can validate the workspace still matches before resuming. The
 * codec validates and normalizes both fields.
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId =
      readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    if (!sessionId) return null;
    const cwd = readNonEmptyString(record.cwd);
    return cwd ? { sessionId, cwd } : { sessionId };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId =
      readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    if (!sessionId) return null;
    const cwd = readNonEmptyString(params.cwd);
    return cwd ? { sessionId, cwd } : { sessionId };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  },
};
