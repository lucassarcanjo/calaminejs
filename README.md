# calaminejs

[calamine](https://github.com/tafia/calamine) — the Rust spreadsheet reader — compiled to
WebAssembly, so the same artifact reads `.xlsx` / `.xls` / `.xlsb` / `.ods` in Node, Bun, Deno,
browsers and edge runtimes without a native addon or a per-platform prebuild.

**Status: not published.** The API below works and is tested; what is missing is the packaging
that would let you install it.

## Using it

```js
sheetNames(bytes)                              // ["Sheet1", "Data"]

readCells(bytes, { sheet, dates, tagged })     // JSON string: rows of cells
toJson(bytes, { sheet, dates, tagged, header });// JSON string: rows as objects
toCsv(bytes, { sheet, dates, delimiter })      // RFC 4180 CSV
toMarkdown(bytes, { sheet, dates })            // GitHub-flavoured table
```

Every function takes the file as bytes — nothing here touches a filesystem, which is what lets
one artifact serve Node, Bun, Deno, browsers and edge workers. An unknown option is an error
rather than a silent no-op, so `{ sheets: "Data" }` tells you instead of quietly reading the
wrong sheet.

`tagged: true` turns each cell into `{ t, v }` with `t` one of `num`, `str`, `bool`, `date`,
`dur`, `err`. That is what makes a date cell distinguishable from text that happens to read
`2020-01-01`. Empty cells are `null` either way. Without tags the distinction is genuinely
lost — a documented tradeoff, and the cheaper payload.

## Why bother

SheetJS is the incumbent and it is slow on anything large. Reading a 23 MB / 1.8M-cell sheet:

| | small (5k cells) | medium (400k) | large (1.8M cells, 23 MB) |
|---|---|---|---|
| `parseOnly` — the floor | 2 ms | 131 ms | 634 ms |
| `toCsv` | 2 ms | 188 ms | **865 ms (5.3x)** |
| `readCells` values | 3 ms | 190 ms | **981 ms (4.7x)** |
| `toMarkdown` | 3 ms | — | 1.07 s (4.3x) |
| `readCells` tagged | 4 ms | 326 ms | 1.53 s (3.0x) |
| SheetJS `sheet_to_json` | 8 ms | 786 ms | 4.61 s |
| SheetJS `sheet_to_csv` | 8 ms | — | 4.57 s |

Node 22.18, macOS arm64, median of N runs. Bun 1.3.5 runs the identical artifact and pulls
further ahead, because SheetJS degrades harder there.

`parseOnly` does the full parse and returns a single integer, so it is the floor — everything
above it is what shaping and crossing the boundary costs. That gap is ~35-55%, which was the
surprise: the boundary is not the bottleneck, so the API does not need to be contorted into a
columnar or batched-iterator shape to be fast.

`toCsv` is the cheapest materialised output because only one string crosses the boundary, no
matter how many cells there are. It is not free — rendering 1.8M cells to text still costs
231 ms over the floor — but it beats building JSON values, and beats SheetJS by 5.3x.

Tagging costs about 55% on top of plain values. Worth it when you need the types, which is why
it is a flag rather than the default.

Artifact size: **370 KB gzipped** (720 KB raw) plus 3.2 KB of JS glue.

## Dates

Excel has no timezone concept. A date cell is a plain number plus a display format, and
calamine's own docs are explicit that the format *"doesn't use or encode timezone information
in any way"*. So a spreadsheet date is a **civil (wall-clock)** value, while a JS `Date` is an
**instant** — converting one to the other requires inventing an offset. That invention is where
most libraries go wrong, so this one refuses to guess and makes it a policy:

| `dates` | result for serial `45943.541` | notes |
|---|---|---|
| `"iso"` (default) | `"2025-10-13T12:59:02.400"` | No offset. Lossless. Exactly what `Temporal.PlainDateTime.from()` accepts. |
| `"serial"` | `45943.541` | Raw, untouched. |
| `"epoch-millis"` | `1760360342400` | Asserts the civil time is UTC. Feeds `new Date(n)`. |

An unrecognised value throws rather than falling back.

The time component is always emitted under `iso`, even at midnight, because `new Date()`
parses a bare `2020-01-01` as UTC but `2020-01-01T00:00:00.000` as local — a uniform shape
keeps that inconsistency away from callers.

**Durations are not dates.** A cell formatted `[h]:mm:ss` holding `1.5` is 36 hours, not
`1900-01-01T12:00`. Those become ISO-8601 durations (`PT36H0M0S`).

### Known sharp edges

- **`epoch-millis` collides serials 60 and 61**, both landing on `1900-03-01`. Excel believes
  1900 was a leap year, so serial 60 is `1900-02-29` — a date that does not exist in a real
  calendar and therefore cannot survive the trip through a JS `Date`. Unavoidable for any
  instant-based representation; it is the main reason `iso` is the default.
- Below serial 60 the epoch is `1899-12-31`, not the `1899-12-30` anchor that only lines up
  *after* the leap-year bug. `serial 0.5` is `1899-12-31T12:00:00.000`.
- Untagged, a date cell and a string cell are both strings and indistinguishable. Pass
  `tagged: true` when that matters.

Cells that already hold an ISO string in the file (ODS throughout, xlsx `t="d"`) are parsed and
routed through the same policy, so they answer to `dates` like any other cell rather than
ignoring it. A string that cannot be parsed is passed through unchanged rather than lost.

Error cells carry their Excel spelling — `#DIV/0!`, `#N/A`, `#REF!`.

## Testing

Upstream has 306 Rust tests over 131 fixtures. Transliterating their assertions would be
laborious and would mostly re-test calamine, which is not the thing at risk here — what needs
proving is that *this* layer, the boundary plus the cell mapping, does not corrupt anything on
the way out. So the corpus is reused but the method is differential:

1. `examples/dump_native.rs` reads a workbook natively and emits the raw `Data` enum, with none
   of this crate's opinions applied.
2. The same file is read through the wasm binding, under all three date policies.
3. `test/differential.mjs` recomputes the expected output **in JavaScript**, from the neutral
   dump, and compares.

Step 3 is the load-bearing one. Checking our Rust against our Rust would only show that wasm
behaves like the host. Rebuilding the mapping independently in a second language means a bug
has to be made twice, the same way, to escape. That is what caught `"P"` and `"PT"` parsing as
zero-length durations instead of being rejected — the unit tests had waved it through.

```
corpus: 135 spreadsheets, 260 sheets, 1538620 cells
policies: iso, serial, epoch-millis  (4615860 cell comparisons)

  format   files  sheets  cells     unopenable  divergences
  .ods     17     39      202       2           0
  .xls     34     81      1527007   3           0
  .xlsb    12     26      57        1           0
  .xlsm    4      10      6         0           0
  .xlsx    68     104     11348     2           0
```

Eight files are rejected by both sides and agree on that — password-protected workbooks and
deliberately truncated ones.

The harness also counts which cell types it actually reached, because "no divergences" is
meaningless over a branch nothing exercised. The first run scored `dtiso` 6 and `duriso` 2
across all 130 upstream files — near-zero coverage of the ISO parsing, the code most likely to
be wrong. `test/make-crafted-fixtures.mjs` fills those in (hand-built ODS and xlsx `t="d"`
cells, all eight `CellErrorType` variants, offsets and truncated times that must pass through
untouched), taking them to 60 and 20.

## Robustness

`test/adversarial.mjs` feeds the binding sixteen kinds of hostile input — empty buffers,
truncated files, a `.csv` renamed to `.xlsx`, a sheet that is not XML, a workbook with no
sheets — and after each one re-reads a known-good file to check the instance is still alive.
That last part is the point: the crate builds with `panic = "abort"`, so a panic anywhere in
calamine would kill the wasm instance for the whole process, not just the failing call.

Current state: every case either returns or throws a clean `Error`, and the instance survives
all of them. calamine returns `Result` rather than panicking on malformed input.

- **A declared dimension is not trusted.** A file claiming `A1:XFD1048576` while holding one
  cell yields one cell — no 17-billion-cell allocation. Cell references outside the declared
  dimension are still read.
- **Memory plateaus but does not shrink.** Reading the 23 MB fixture settles at ~153 MB of wasm
  memory and stays there across repeated reads, so there is no leak — but that is a ~6.6x
  amplification, and wasm memory is never returned to the OS. Relevant to the ceiling question
  below.
- **Non-finite floats become `null`**, silently and indistinguishably from an empty cell. JSON
  has no `Infinity`, and Excel cannot store one, so this only fires on crafted files.

### SheetJS does not round-trip its own dates

Worth knowing if you benchmark against it. Writing `new Date(Date.UTC(2020,0,1))` on a machine
in `America/Sao_Paulo` stores serial `43830.87467592592`, which is `2019-12-31T20:59:32` — the
writer applied a local offset. Its reader then applies a *different* fudge and returns
`23:59:59.999`. calamine returns the value the file actually contains.

## Layout

```
src/lib.rs                      the wasm surface: functions and their options
src/cells.rs                    the cell model — values vs tagged
src/dates.rs                    date policies, civil time, ISO parsing
src/output.rs                   objects, CSV, Markdown
examples/dump_native.rs         reference dumper: raw calamine Data, no opinions applied

bench/make-fixtures.mjs         perf fixtures (small/medium/large)
bench/make-date-fixture.mjs     date fixture, written as raw serials so the bytes are known
bench/bench.mjs                 the benchmark, runs identically under Node and Bun
bench/check.mjs                 structural comparison against SheetJS
bench/check-dates.mjs           11 date cases incl. the 59/60/61 leap-bug boundary

test/fetch-fixtures.sh          fetches calamine's corpus, pinned to v0.36.1
test/make-crafted-fixtures.mjs  fixtures for the branches upstream barely reaches
test/differential.mjs           the corpus, cross-checked against a JS reimplementation
test/outputs.mjs                tagged cells, objects, CSV, Markdown, option validation
test/adversarial.mjs            16 hostile inputs + a liveness check after each
test/zip.mjs                    STORE-only zip writer, for hand-building hostile files
```

```sh
bun run fixtures   # fetch + generate everything (~44 MB, not committed)
bun run build      # wasm-pack
bun run test       # cargo test + dates + adversarial + differential
bun run bench      # or bench:bun
```

## Build and run

Requires Rust 1.88+ (pinned to 1.97.1 in `rust-toolchain.toml`), `wasm-pack`, and `binaryen`
for `wasm-opt`.

```sh
rustup target add wasm32-unknown-unknown
brew install wasm-pack binaryen

bun install
bun run build
bun run fixtures
bun run test
```

## Notes on the build

calamine and its whole dependency tree (`zip`, `quick-xml`, `zlib-rs`) cross-compile to
`wasm32-unknown-unknown` unmodified — no C toolchain, no emscripten.

Neither the `dates` feature nor chrono is enabled. That feature gates nothing but the chrono
helper methods; date *detection* from number formats is always on. `ExcelDateTime::to_ymd_hms_milli`
returns the civil fields directly with millisecond precision and handles the 1900/1904 epochs
internally, which is both more faithful and 9 KB smaller.

## What is left

1. **Packaging.** The only thing between this and `npm install`. The plan, modelled on what
   Automerge, sqlite-wasm and resvg-wasm actually ship: an `exports` map with a `node` entry
   (`readFileSync` + `initSync`), a `workerd` / `edge-light` entry that imports the `.wasm`
   as a module, a default entry using `new URL(...)` + `instantiateStreaming` for browsers and
   bundlers, the raw `.wasm` exposed as a subpath, and base64 as an opt-in `/inline` subpath
   rather than the default. Measured: `fetch` on a `file://` URL works in Bun 1.3.5 and Deno
   2.9.3 but not Node 22.18, so Node is the only runtime needing its own entry. Unverified:
   whether Vercel Edge resolves `edge-light` for this layout — needs a deploy, not more reading.
2. **Memory ceiling.** Reading the 23 MB fixture settles at ~153 MB of wasm memory, roughly 6.6x
   the file size, and wasm32 caps at 4 GB. That puts the ceiling somewhere in the low hundreds
   of MB. Not measured, and worth knowing before someone finds it with a 200 MB export.
3. **`dates: "temporal"`.** Temporal reached Stage 4 in March 2026 and ships in Node 26; the
   `iso` output is already exactly what `Temporal.PlainDateTime.from()` accepts, so callers on
   a modern runtime can convert today. Returning Temporal objects directly measured 314x
   slower than strings (via `temporal-polyfill`, so native will be better), and Temporal
   rejects `1900-02-29` just as `Date` does — so the string stays the default and this is an
   opt-in at most.
