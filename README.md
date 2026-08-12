# calamine

[![CI](https://github.com/lucassarcanjo/calaminejs/actions/workflows/ci.yml/badge.svg)](https://github.com/lucassarcanjo/calaminejs/actions/workflows/ci.yml)

**Fast, zero-dependency spreadsheet parsing for JavaScript.**

Read `.xlsx`, `.xls`, `.xlsb` and `.ods` files and convert them to JSON, CSV, Markdown or
typed cells.

Powered by [calamine](https://github.com/tafia/calamine) and WebAssembly. The same package
runs in Node.js, Bun, Deno, browsers and edge runtimes.

```sh
npm install calamine
```

```ts
import { toJsonParsed, ready } from "calamine";

await ready();                     // no-op outside browsers; see below
const rows = toJsonParsed(bytes);  // bytes: Uint8Array
```

**Why calamine?**

- ⚡ Up to **5x faster than SheetJS** on large workbooks
- 📦 **Zero dependencies**
- 🌍 Node.js, Bun, Deno, browsers and edge runtimes
- 📊 XLSX, XLS, XLSB and ODS
- 🔄 JSON, CSV, Markdown and typed cell output
- 📅 Predictable Excel date and duration handling

> Read-only by design. If you need to create or style spreadsheets, use ExcelJS or SheetJS.

An **unofficial** binding: calamine is [tafia's](https://github.com/tafia/calamine) and does
the parsing, while this repo decides what the values look like in JavaScript. Please report
problems here rather than upstream — [CONTRIBUTING](CONTRIBUTING.md) explains how to tell a
binding bug from one in the parser.

## Using it

```ts
import { sheetNames, toCsv, readCellsParsed, ready } from "calamine";

const bytes = new Uint8Array(await file.arrayBuffer());

await ready();                        // no-op outside browsers; see below

sheetNames(bytes);                    // ["Sheet1", "Data"]
toCsv(bytes);                         // "name,when\na,2020-01-01T00:00:00.000\n"
readCellsParsed(bytes);               // [["name", "when"], ["a", "2020-01-01T00:00:00.000"]]
```

Every function takes the file as bytes. Nothing here touches a filesystem, which is what lets
one artifact serve Node, Bun, Deno, browsers and edge workers.

That snippet is [`examples/js/quickstart.ts`](examples/js/quickstart.ts), runnable and
type-checked in CI so it cannot drift from the API.

### The full surface

| | returns |
|---|---|
| `sheetNames(bytes)` | `string[]` — workbook order. Only reads metadata, so it is cheap. |
| `readCellsParsed(bytes, o?)` | `Cell[][]`, or `TaggedCell[][]` with `tagged: true` |
| `toJsonParsed(bytes, o?)` | `Row[]` keyed by the header row, or `Cell[][]` with `header: "none"` |
| `toCsv(bytes, o?)` | RFC 4180 `string` |
| `toMarkdown(bytes, o?)` | GitHub-flavoured table |
| `readCells` / `toJson` | the same data as an **unparsed JSON string** |
| `ready()` | `Promise<void>` — resolves once the wasm is usable |

Options are `{ sheet, dates, tagged }`, plus `header` on the JSON outputs and `delimiter` on
CSV. `sheet` defaults to the first one.

`readCells` and `toJson` return a string because only one value crosses the wasm boundary that
way, however large the sheet. The `…Parsed` variants are `JSON.parse` and nothing more — reach
for them unless you are about to hand the JSON straight to something else, in which case not
parsing it at all is the faster path.

An unknown option is an error rather than a silent no-op, so `{ sheets: "Data" }` tells you
instead of quietly reading the wrong sheet.

### Types

`tagged: true` turns each cell into `{ t, v }` with `t` one of `num`, `str`, `bool`, `date`,
`dur`, `err`. That is what makes a date cell distinguishable from text that happens to read
`2020-01-01`. Empty cells are `null` either way. Without tags the distinction is genuinely
lost — a documented tradeoff, and the cheaper payload.

```ts
readCellsParsed(bytes, { tagged: true });
// [[{ t: "str", v: "name" }], [{ t: "date", v: "2020-01-01T00:00:00.000" }]]
```

The return type follows the flag, so neither shape needs a cast.

### Waiting for the wasm

On Node, Bun, Deno and Cloudflare Workers the wasm loads synchronously and the functions work
the moment you import them. In a browser or a bundled app it loads asynchronously, so
`await ready()` first — that call is already resolved everywhere else, so awaiting it always is
portable.

## Why bother

SheetJS is the incumbent and it is slow on anything large. Reading a 23 MB / 1.8M-cell sheet:

| | small (5k cells) | medium (400k) | large (1.8M cells, 23 MB) |
|---|---|---|---|
| `toCsv` | 2 ms | 188 ms | **865 ms (5.3x)** |
| `readCells` values | 3 ms | 190 ms | **981 ms (4.7x)** |
| `readCells` tagged | 4 ms | 326 ms | 1.53 s (3.0x) |
| SheetJS `sheet_to_json` | 8 ms | 786 ms | 4.61 s |
| SheetJS `sheet_to_csv` | 8 ms | — | 4.57 s |

Node 22.18, macOS arm64, median of N runs. Bun 1.3.5 runs the identical artifact and pulls
further ahead, because SheetJS degrades harder there. Run them yourself with `bun run bench`.

Speed is the least interesting difference, though. **[docs/comparison.md](docs/comparison.md)**
puts the readers side by side on correctness — dates, cell types, error values — and is honest
about where this library loses.

The full parse costs 634 ms of that large-file number, so the JS/wasm boundary is 35-55% on
top — which was the surprise. The boundary is not the bottleneck, so the API does not need to
be contorted into a columnar or batched-iterator shape to be fast.

Artifact size: **370 KB gzipped** (720 KB raw) plus 3.2 KB of JS glue.

## Dates, carefully

Excel has no timezone concept, so a spreadsheet date is a **civil (wall-clock)** value while a
JS `Date` is an **instant**. Converting one to the other has to invent an offset, and that
invention is where most libraries go wrong. This one refuses to guess and makes it a policy:

| `dates` | serial `45943.541` becomes |
|---|---|
| `"iso"` (default) | `"2025-10-13T12:59:02.400"` — no offset, lossless |
| `"serial"` | `45943.541` — raw |
| `"epoch-millis"` | `1760360342400` — asserts the civil time is UTC |

Durations are not dates: a cell formatted `[h]:mm:ss` holding `1.5` is `PT36H0M0S`, not a day
in 1900. **[docs/dates.md](docs/dates.md)** has the rest, including the 1900 leap-year bug and
the two places the conversion is genuinely lossy.

## Documentation

| | |
|---|---|
| **[docs/dates.md](docs/dates.md)** | the date policies, the sharp edges, and why SheetJS disagrees |
| **[docs/packaging.md](docs/packaging.md)** | five entry points, the `exports` conditions, and what each runtime needs |
| **[docs/testing.md](docs/testing.md)** | the differential method, the corpus, adversarial inputs, CI |
| **[docs/comparison.md](docs/comparison.md)** | measured against SheetJS, ExcelJS and others — including where we lose |
| **[docs/roadmap.md](docs/roadmap.md)** | what is not done yet |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | building it, and the rules for changing cell behaviour |

## Which entry point you get

One wasm binary behind five entries, chosen by `exports` conditions. They differ only in how
the bytes reach the glue, which is the one thing every runtime does differently.

| entry | condition | how the wasm loads |
|---|---|---|
| `dist/node.js` | `node` | `node:fs` + `initSync` — synchronous |
| `dist/workerd.js` | `workerd` | `import wasm from "./…wasm"` — Workers want a Module |
| `dist/streaming.js` | `browser`, `import` | `fetch` + `instantiateStreaming` |
| `calamine/inline` | — | base64 in the JS, for builds with no companion asset |
| `calamine/slim` | — | you supply the bytes or Module |

Most callers import `calamine` and never think about it. See
**[docs/packaging.md](docs/packaging.md)** for the two that are opt-in and why.

## Layout

```
src/lib.rs                      the wasm surface: functions and their options
src/cells.rs                    the cell model — values vs tagged
src/dates.rs                    date policies, civil time, ISO parsing
src/output.rs                   objects, CSV, Markdown
types/                          the hand-written .d.ts, copied into dist/
scripts/build.mjs               assembles dist/ from the wasm-pack output
examples/dump_native.rs         reference dumper: raw calamine Data, no opinions applied
examples/js/                    runnable versions of the snippets in this README

bench/                          benchmarks and their large fixtures
test/support/                   shared helpers, fixture builders, paths
test/node/                      suites that run under Node
test/browser/                   Playwright, against a real engine over real HTTP
test/worker/                    Cloudflare Workers — not implemented, see its README
```

Tests are organised by **where the code runs**, because that is what actually varies — the
parser is identical everywhere, and what differs is how the wasm reaches it.
[`test/README.md`](test/README.md) has the detail.

## Building it

```sh
bun install
bun run build      # wasm-pack, then assembles dist/
bun run fixtures   # ~44 MB, fetched and generated, not committed
bun run test
```

Needs Rust (pinned in `rust-toolchain.toml`), `wasm-pack`, and binaryen 131+ for `wasm-opt`.
**[CONTRIBUTING.md](CONTRIBUTING.md)** has the detail, including why that binaryen version
matters.

## Licence

MIT. The published `.wasm` statically links calamine and ~50 other crates; their notices are in
[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md), regenerated from `Cargo.lock` and checked
in CI.
