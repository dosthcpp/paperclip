/**
 * UI module exports — used by Paperclip's dashboard for run viewing
 * and agent configuration forms.
 *
 * Phase 2 (TON-2269): vendored in-tree from the external
 * `hermes-paperclip-adapter` package. The UI registry imports these
 * symbols via `@paperclipai/adapter-hermes-local/ui`.
 */

export { parseHermesStdoutLine } from "./parse-stdout.js";
export { buildHermesConfig } from "./build-config.js";
