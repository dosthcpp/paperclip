# Hermes in-tree adapter — implementation plan (TON-2230, Option B)

## Why

The Hermes runtime ("Atlas") prints code/`curl` and dies, and never sees its
context. Root cause (forensics: `docs/ton-2230/hermes-adapter-forensics.md`):
Hermes execution lives in the **external** npm package
`hermes-paperclip-adapter` (pinned `^0.2.0`, frozen ~2 months). The monorepo
only has a thin registry wrapper. `execute.ts` edits never touched it because
that file is the **codex-local** adapter.

The board chose **Option B**: vendor Hermes as a first-class in-tree adapter at
`packages/adapters/hermes-local`, mirroring `codex-local`, so the team owns the
execution path and can deliver the capabilities the external package never did.

### The literal answer to the issue title ("tools.md / heartbeat.md 위치는?")

They are **not delivered to Hermes at all today**. In
`server/src/adapters/registry.ts`, `hermesLocalAdapter` is registered with
`supportsInstructionsBundle: false` and **no** `instructionsPathKey`. Every other
adapter (claude/codex/acpx/pi) sets `supportsInstructionsBundle: true` +
`instructionsPathKey`, so Paperclip materializes their instruction files. Hermes
is the only one excluded. Option B lets us flip this on (see `INSTRUCTIONS_PATH_KEY`
in `src/index.ts`).

## Phased migration

### Phase 1 — package boundary (this commit)
- New workspace package `@paperclipai/adapter-hermes-local`.
- `src/index.ts` declares `type`, `label`, `models`, `agentConfigurationDoc`,
  and the new `INSTRUCTIONS_PATH_KEY = "instructionsFilePath"`.
- `src/server/index.ts` / `src/ui/index.ts` re-export the external impl as a
  temporary baseline so nothing regresses while later phases land.
- No registry change yet — purely additive.

### Phase 2 — vendor source (child issue)
- Port upstream Hermes adapter TS into `src/server/*` (execute, parse,
  sessionCodec, skills, test-env), replacing the Phase-1 re-exports.
- Remove `hermes-paperclip-adapter` from `server/package.json`.

### Phase 3 — capabilities (child issues)
1. **Instruction bundle** (the issue-title fix): in `registry.ts` set
   `supportsInstructionsBundle: true` + `instructionsPathKey: "instructionsFilePath"`
   for `hermes_local`, and materialize TOOLS.md / HEARTBEAT.md / AGENTS.md.
2. **Wake context + session continuity**: inject comment bodies, wake payload,
   continuation summary, and thread history into the prompt builder; harden
   `--resume`/sessionId against `AdapterExecutionContext` drift.
3. **Run robustness**: `--max-turns` + `--yolo` (no-TTY approval bypass) so runs
   don't single-shot and die; fix the `timeoutSec || DEFAULT` falsy-zero bug so
   `timeoutSec: 0` means "no timeout".

### Phase 4 — registry swap + cutover
- Point `server/src/adapters/registry.ts` at `@paperclipai/adapter-hermes-local`
  instead of `hermes-paperclip-adapter`.
- Drop the `normalizeHermesConfig` cast workaround once the in-tree
  `AdapterExecutionContext` type matches.
- Tests: parse, build-config, execute (remote), session round-trip.

## Reference
- Pattern to mirror: `packages/adapters/codex-local`, `packages/adapters/pi-local`.
- Forensics: `docs/ton-2230/hermes-adapter-forensics.md`.
