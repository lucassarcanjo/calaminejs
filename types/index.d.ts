// The default entry, and `calaminejs/inline`. Both load the wasm themselves, so
// what they add over the shared surface is `ready()`.
export * from "./api.js";

/**
 * Resolves once the wasm is usable.
 *
 * On Node, Bun, Deno and Cloudflare Workers this is already true on import and
 * the promise is resolved. In a browser or a bundled app the wasm loads
 * asynchronously, so await this first. Awaiting it always is portable.
 */
export function ready(): Promise<void>;
