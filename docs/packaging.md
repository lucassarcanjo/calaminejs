# Packaging

One wasm binary, five entry points, and why each runtime needs its own.

One wasm binary, five entry points, chosen by `exports` conditions. They differ only in how the
bytes reach the glue, which is the one thing every runtime does differently.

| entry | condition | how the wasm loads |
|---|---|---|
| `dist/node.js` | `node` | `node:fs` + `initSync` — synchronous |
| `dist/workerd.js` | `workerd` | `import wasm from "./…wasm"` — Workers want a compiled Module, not bytes |
| `dist/streaming.js` | `browser`, `import` | `fetch` + `instantiateStreaming` |
| `dist/inline.js` | `calamine/inline` | base64 in the JS, for builds that cannot ship a companion asset |
| `dist/slim.js` | `calamine/slim` | you supply the bytes or Module |

The raw binary is also exported as `calamine/calamine_wasm_bg.wasm`, which is how Workers
projects and some bundlers prefer to resolve it themselves.

Bun and Deno both resolve the `node` condition and both implement `node:fs`, so all three
runtimes share the synchronous entry. That is deliberate rather than lazy: `fetch` on a
`file://` URL works in Bun 1.3.5 and Deno 2.9.3 but **not** Node 22.18, which is precisely why
Node needs its own entry.

No entry uses top-level await. It would make the package unrequirable from CJS and is
contagious through bundlers.

Base64 is an opt-in subpath rather than the default. It costs a third more bytes, is parsed as
JS text on every load, and gives up both streaming compilation and separate caching of the
binary — none of which buys anything in the runtimes that can load a `.wasm` properly. It adds
about 130 KB to the published tarball, which is the price of having the escape hatch.

`test/node/entrypoints.test.ts` imports each entry in its own subprocess and makes it read a
file; `test/browser/` does the same in a real Chromium over real HTTP, including inside a Web
Worker. The isolation matters: the entries share one glue module and ES modules are singletons,
so importing two in one process — or one page — would let the first initialise the second and
hide a broken loader.

The browser suite is the only place the streaming path is exercised for real. Under Node it can
only be shown to *fail*, which is the reason the `node` condition exists.

## Notes on the build

calamine and its whole dependency tree (`zip`, `quick-xml`, `zlib-rs`) cross-compile to
`wasm32-unknown-unknown` unmodified — no C toolchain, no emscripten.

Neither the `dates` feature nor chrono is enabled. That feature gates nothing but the chrono
helper methods; date *detection* from number formats is always on. `ExcelDateTime::to_ymd_hms_milli`
returns the civil fields directly with millisecond precision and handles the 1900/1904 epochs
internally, which is both more faithful and 9 KB smaller.

## Types

Each entry's declarations live in `types/` and are copied into `dist/` by the
build, rather than being generated as a string inside `scripts/build.mjs` — which
is how `./slim` came to advertise a `ready()` it does not export.

`./slim` has its own `slim.d.ts` because its surface genuinely differs: no
`ready()`, and `init`/`initSync` instead. Those two return wasm-bindgen's
`InitOutput`, re-exported from the generated glue declarations rather than
restated, so it carries `memory` — owning the instance's memory is most of the
reason to choose this entry.

A top-level `types` field and a `typesVersions` map sit alongside the `exports`
map for TypeScript on the legacy `moduleResolution: node`, which cannot read an
exports map and would otherwise treat the package as untyped. There is
deliberately no `main` beside them: a bundler too old to understand `exports`
would resolve the Node entry into a browser build, and failing loudly beats
shipping `node:fs` to a browser.

`scripts/check-publish.mjs` verifies every one of those paths resolves before a
tarball is cut, because nothing in this repo consumes the legacy fallbacks — a
broken one has no local symptom.
