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

## support/

| file | what it is |
|---|---|
| `paths.mjs` | every path in one place, so moving a directory is one edit |
| `zip.mjs` | a STORE-only zip writer, for hand-building files no library will produce |
| `make-crafted-fixtures.mjs` | fixtures for branches calamine's own corpus barely reaches |
| `make-date-fixture.mjs` | dates written as raw serials, so the bytes on disk are known |
| `fetch-fixtures.sh` | fetches calamine's corpus, pinned to the tag we build against |

## node/

Run with `bun run test:node`. Plain scripts with a non-zero exit on failure —
no framework, because they mostly print tables that are worth reading.

| suite | what it proves |
|---|---|
| `differential.test.mjs` | every cell of calamine's 135-file corpus matches, with the expectation recomputed in JS |
| `dates.test.mjs` | the date policies, including the 59/60/61 leap-year boundary |
| `outputs.test.mjs` | tagged cells, objects, CSV, Markdown, option validation |
| `entrypoints.test.mjs` | each packaging entry, imported for real in its own subprocess |
| `adversarial.test.mjs` | 16 hostile inputs, each followed by a liveness check |
| `sheetjs-comparison.test.mjs` | structural agreement with SheetJS on the same file |

## browser/

Run with `bun run test:browser`. The **only** place the streaming path is
exercised for real — `fetch` plus `WebAssembly.instantiateStreaming` against an
HTTP response in an actual engine. The Node suite can only prove that path
*fails* there, which is why the `node` condition exists at all.

| file | what it is |
|---|---|
| `calaminejs.spec.mjs` | the suite |
| `harness.html` | a bare page exposing `loadEntry` and `fetchFixture` |
| `worker.js` | a Web Worker, since parsing on the main thread janks the page |
| `server.mjs` | static server — serves `.wasm` as `application/wasm`, which is load-bearing |
| `global-setup.mjs` | fails early and clearly if `dist/` or the fixtures are missing |

Each test gets a fresh page on purpose. The entries share one glue module and ES
modules are singletons, so importing two in one page would let the first
initialise the second and hide a broken loader.

The MIME type in `server.mjs` is not incidental. `instantiateStreaming` refuses
a response that is not `application/wasm`, and the glue then quietly falls back
to buffering — a test would still pass while proving nothing about streaming.
Changing that one header does make the suite fail, which was checked.

## Getting the fixtures

```sh
bun run build      # dist/ — the suites import the built package, not the crate
bun run fixtures   # ~44 MB, fetched and generated
```
