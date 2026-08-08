# Tests

Organised by **where the code runs**, because that is what actually varies. The
parser is the same everywhere; what differs between runtimes is how the wasm
binary reaches it, and that is where the bugs live.

```
test/
  support/    shared helpers and fixture builders — no assertions here
  node/       suites that run under Node
  browser/    Playwright, against a real engine over real HTTP
  worker/     Cloudflare Workers — not implemented yet, see its README
  fixtures/   generated and fetched; never committed
```

Adding a runtime means adding a sibling directory (`deno/`, `bun/`, `edge/`),
not threading another conditional through an existing suite.

## Why these are TypeScript

There is no build step. Node 22.18+ strips types on its own and Bun runs `.ts`
natively, so `node test/node/dates.test.ts` just works and `bun run typecheck`
is a separate, emit-free pass.

The reason for the types is not the tests — it is `dist/*.d.ts`. Those
declarations are written by hand against a wasm binary, so nothing else can
verify they are true. Making the suites their first typed consumer turns them
into a checked artifact: the mistyped `./slim` subpath, which promised a
`ready()` that entry does not export, was found this way and not by reading.

`types.test.ts` is the backstop. A declaration that nothing consumes is not
checked by anything, only parsed — `slim.d.ts` once declared `initSync` as
returning `void`, which was internally consistent, compiled fine, and was still
wrong. So every claim there is asserted twice: once as a type, once against the
value at runtime.

For the same reason the suites import `calaminejs` by name rather than reaching
into `../../dist/`. A self-reference resolves through the `exports` map, so what
gets tested is the condition a user's runtime actually picks and the types that
condition advertises. `adversarial.test.ts` is the exception: it imports the raw
glue for `parseOnly` and the `WebAssembly.Memory`, neither of which is public.

## support/

| file | what it is |
|---|---|
| `paths.ts` | every path in one place, so moving a directory is one edit |
| `zip.ts` | a STORE-only zip writer, for hand-building files no library will produce |
| `make-crafted-fixtures.ts` | fixtures for branches calamine's own corpus barely reaches |
| `make-date-fixture.ts` | dates written as raw serials, so the bytes on disk are known |
| `fetch-fixtures.sh` | fetches calamine's corpus, pinned to the tag we build against |

## node/

Run with `bun run test:node`. Plain scripts with a non-zero exit on failure —
no framework, because they mostly print tables that are worth reading.

| suite | what it proves |
|---|---|
| `differential.test.ts` | every cell of calamine's 135-file corpus matches, with the expectation recomputed in JS |
| `dates.test.ts` | the date policies, including the 59/60/61 leap-year boundary |
| `outputs.test.ts` | tagged cells, objects, CSV, Markdown, option validation |
| `entrypoints.test.ts` | each packaging entry, imported for real in its own subprocess |
| `adversarial.test.ts` | 16 hostile inputs, each followed by a liveness check |
| `sheetjs-comparison.test.ts` | structural agreement with SheetJS on the same file |
| `types.test.ts` | the shipped `.d.ts` — every claim asserted as a type *and* against the runtime value |

## browser/

Run with `bun run test:browser`. The **only** place the streaming path is
exercised for real — `fetch` plus `WebAssembly.instantiateStreaming` against an
HTTP response in an actual engine. The Node suite can only prove that path
*fails* there, which is why the `node` condition exists at all.

| file | what it is |
|---|---|
| `calaminejs.spec.ts` | the suite |
| `harness.html` | a bare page exposing `loadEntry` and `fetchFixture` |
| `harness.d.ts` | types for those two globals — `page.evaluate` runs in another realm, so they have to be declared |
| `worker.js` | a Web Worker, since parsing on the main thread janks the page |
| `server.ts` | static server — serves `.wasm` as `application/wasm`, which is load-bearing |
| `global-setup.ts` | fails early and clearly if `dist/` or the fixtures are missing |

Each test gets a fresh page on purpose. The entries share one glue module and ES
modules are singletons, so importing two in one page would let the first
initialise the second and hide a broken loader.

The MIME type in `server.ts` is not incidental. `instantiateStreaming` refuses
a response that is not `application/wasm`, and the glue then quietly falls back
to buffering — a test would still pass while proving nothing about streaming.
Changing that one header does make the suite fail, which was checked.

## Getting the fixtures

```sh
bun run build      # dist/ — the suites import the built package, not the crate
bun run fixtures   # ~44 MB, fetched and generated
```
