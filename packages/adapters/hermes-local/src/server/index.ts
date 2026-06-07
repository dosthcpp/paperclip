/**
 * Server surface for the in-tree Hermes Agent adapter (TON-2230, Option B).
 *
 * ----------------------------------------------------------------------------
 * STAGED MIGRATION — DO NOT TREAT AS COMPLETE.
 * ----------------------------------------------------------------------------
 * Phase 1 (this commit): establish the package boundary and re-export the
 * existing external implementation so nothing regresses while the port lands.
 * The external dist is the temporary baseline ONLY.
 *
 * Phase 2 (child issue — vendor source): replace the re-exports below with real
 * in-tree TypeScript ported from the upstream Hermes adapter, then drop the
 * `hermes-paperclip-adapter` dependency from `server/package.json`.
 *
 * Phase 3 (child issues — features): implement the capabilities the external
 * package never shipped:
 *   - instruction bundle delivery (set supportsInstructionsBundle: true and
 *     instructionsPathKey in server/src/adapters/registry.ts)
 *   - wake-context / thread injection into the prompt builder
 *   - session continuity (--resume) hardened against AdapterExecutionContext drift
 *   - --max-turns / --yolo
 *   - timeout falsy-zero fix (timeoutSec=0 must mean "no timeout")
 *
 * Each phase is tracked as a child of TON-2230.
 */

export {
  execute,
  testEnvironment,
  sessionCodec,
  listSkills,
  syncSkills,
  detectModel,
  // eslint-disable-next-line import/no-unresolved -- temporary Phase-1 baseline; vendored in Phase 2
} from "hermes-paperclip-adapter/server";
