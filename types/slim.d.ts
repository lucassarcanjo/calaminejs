// `calaminejs/slim` — bring your own wasm.
//
// This entry deliberately has no `ready()`. There is nothing for it to wait on:
// initialisation is the caller's, and it finishes when `initSync` returns or
// the `init` promise resolves. Pointing this subpath at the default entry's
// types, which is what it used to do, promised a `ready` that does not exist
// and gave no types at all for the two functions the entry exists for.
export * from "./api.js";

// Re-exported from wasm-bindgen's own generated declarations rather than
// restated here. Both files are emitted by the same build, so this cannot drift
// — and `InitOutput` in particular has to be the real thing: it carries
// `memory`, and owning the instance's memory is a large part of why anyone
// reaches for this entry instead of the default one.
export type { InitInput, InitOutput, SyncInitInput } from "./calamine_wasm.js";

import type { InitInput, InitOutput, SyncInitInput } from "./calamine_wasm.js";

/**
 * Compiles the wasm synchronously from bytes or an already-compiled Module, and
 * returns the instance's exports — including `memory`.
 *
 * Passing `SyncInitInput` bare is deprecated upstream; prefer `{ module }`.
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * Loads and compiles the wasm from a URL, `Response`, bytes or a Module.
 *
 * Passing `InitInput` bare is deprecated upstream; prefer `{ module_or_path }`.
 * With no argument the glue resolves the binary next to itself via
 * `new URL(..., import.meta.url)`, which bundlers rewrite to a hashed asset.
 */
export default function init(
  module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<InitOutput>;
