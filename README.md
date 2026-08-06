# calaminejs

[calamine](https://github.com/tafia/calamine) — the Rust spreadsheet reader — compiled to
WebAssembly, so the same artifact reads `.xlsx` / `.xls` / `.xlsb` / `.ods` in Node, Bun, Deno,
browsers and edge runtimes without a native addon or a per-platform prebuild.

**Status: spike.** The API is not settled and nothing is published. What exists is enough to
answer the questions that decide the API, and the answers are below.

## Why bother

SheetJS is the incumbent and it is slow on anything large. Reading a 23 MB / 1.8M-cell sheet:

| | small (5k cells) | medium (400k) | large (1.8M cells, 23 MB) |
|---|---|---|---|
| wasm: parse only (floor) | 2 ms | 133 ms | 670 ms |
| wasm: JSON string + `JSON.parse` | 3 ms | 204 ms | **885 ms (5.1x)** |
| wasm: serde-wasm-bindgen | 3 ms | 197 ms | **942 ms (4.8x)** |
| SheetJS: read + `sheet_to_json` | 8 ms | 839 ms | 4.55 s |

Node 22.18, macOS arm64, median of N runs. Bun 1.3.5 runs the identical artifact and reaches
9.5x on the large fixture, because SheetJS degrades harder there (8.23 s).

`parse only` does the full parse and returns a single integer, so it is the floor — everything
above it is what the JS/wasm boundary costs. That gap is only ~30%, which was the surprise:
the boundary is not the bottleneck, so the API does not need to be contorted into a columnar
or batched-iterator shape to be fast.

Artifact size: **351 KB gzipped** (680 KB raw) plus 3.2 KB of JS glue.

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
- Over the JSON boundary a date cell and a string cell are both strings, and indistinguishable.
  Unresolved — see below.

### SheetJS does not round-trip its own dates

Worth knowing if you benchmark against it. Writing `new Date(Date.UTC(2020,0,1))` on a machine
in `America/Sao_Paulo` stores serial `43830.87467592592`, which is `2019-12-31T20:59:32` — the
writer applied a local offset. Its reader then applies a *different* fudge and returns
`23:59:59.999`. calamine returns the value the file actually contains.

## Layout

```
src/lib.rs                  the binding: 3 boundary strategies, 3 date policies
bench/make-fixtures.mjs     perf fixtures (small/medium/large)
bench/make-date-fixture.mjs date fixture, written as raw serials so the bytes are known
bench/bench.mjs             the benchmark, runs identically under Node and Bun
bench/check.mjs             structural comparison against SheetJS
bench/check-dates.mjs       11 date cases incl. the 59/60/61 leap-bug boundary
```

## Build and run

Requires Rust 1.88+ (pinned to 1.97.1 in `rust-toolchain.toml`), `wasm-pack`, and `binaryen`
for `wasm-opt`.

```sh
rustup target add wasm32-unknown-unknown
brew install wasm-pack binaryen

bun install
wasm-pack build --release --target web --out-dir pkg

node bench/make-fixtures.mjs        # ~23 MB of fixtures, not committed
node bench/make-date-fixture.mjs
node bench/check-dates.mjs
node bench/bench.mjs
bun  bench/bench.mjs
```

## Notes on the build

calamine and its whole dependency tree (`zip`, `quick-xml`, `zlib-rs`) cross-compile to
`wasm32-unknown-unknown` unmodified — no C toolchain, no emscripten.

Neither the `dates` feature nor chrono is enabled. That feature gates nothing but the chrono
helper methods; date *detection* from number formats is always on. `ExcelDateTime::to_ymd_hms_milli`
returns the civil fields directly with millisecond precision and handles the 1900/1904 epochs
internally, which is both more faithful and 9 KB smaller.

## Open questions

1. **Packaging.** Base64-inline single file vs. `exports` conditions. Decides whether it works
   on edge/workers unmodified. Currently `--target web`, loaded by hand in the benchmarks.
2. **API surface.** With the boundary cheap, probably `readSheet(bytes, opts)` returning objects
   with a header-row mode, rather than raw row arrays.
3. **Type fidelity at the boundary.** JSON cannot distinguish a date cell from a string cell.
   That is an argument for the `serde-wasm-bindgen` path despite JSON being the steadier
   performer, or for a parallel type map.
4. **Memory ceiling.** 23 MB is fine; the breaking point is not yet known.
