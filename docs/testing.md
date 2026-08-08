# Testing

The corpus is calamine's own, but the method is differential — the expected
value is recomputed in JavaScript so a bug has to be made twice to escape.

Upstream has 306 Rust tests over 131 fixtures. Transliterating their assertions would be
laborious and would mostly re-test calamine, which is not the thing at risk here — what needs
proving is that *this* layer, the boundary plus the cell mapping, does not corrupt anything on
the way out. So the corpus is reused but the method is differential:

1. `examples/dump_native.rs` reads a workbook natively and emits the raw `Data` enum, with none
   of this crate's opinions applied.
2. The same file is read through the wasm binding, under all three date policies.
3. `test/node/differential.test.ts` recomputes the expected output **in JavaScript**, from the neutral
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
be wrong. `test/support/make-crafted-fixtures.ts` fills those in (hand-built ODS and xlsx `t="d"`
cells, all eight `CellErrorType` variants, offsets and truncated times that must pass through
untouched), taking them to 60 and 20.

## Robustness

`test/node/adversarial.test.ts` feeds the binding sixteen kinds of hostile input — empty buffers,
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


## CI

Four jobs on push to `main` and on every pull request.

| job | what it does |
|---|---|
| `build` | compiles the wasm once and uploads `dist/` plus the native reference dumper |
| `rust` | `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `node` | downloads the artifacts, fetches the corpus, runs the six Node suites |
| `browser` | downloads `dist/`, installs Chromium, runs Playwright |

The wasm is built **once** and shared. Building it per job would triple the slowest step for no
extra signal, and would let the Node and browser suites test two separately-compiled binaries —
which is exactly the class of difference this repo keeps finding by accident.

`node` needs the native `dump_native` binary for the differential pass, so `build` produces it
too. That keeps Rust out of the `node` job entirely.

Two things are cached: calamine's corpus, keyed on the hash of `fetch-fixtures.sh` so bumping
the pinned tag misses on purpose; and the Playwright browsers, keyed on the lockfile. CI only
generates the `small` benchmark fixture — the 23 MB one is a minute of nothing useful there,
which is why `make-fixtures.mjs` takes sizes as arguments.

The pinned toolchain is installed explicitly rather than by trusting rustup to pick it up from
`rust-toolchain.toml`, since that behaviour has varied by rustup version. The channel, target
and components still come from that file; the workflow does not restate the version.

**binaryen is pinned to 131 and downloaded, not `apt install`ed.** Ubuntu noble still ships
binaryen 108, from 2022, and that `wasm-opt` mangles the externref table wasm-bindgen emits.
The result is a binary that cannot instantiate at all — failing with
`WebAssembly.Table.grow(): failed to grow table by 4`, an error whose stack points nowhere near
the cause. It does this silently, so the build reports success and two downstream jobs fail
instead.

`bun run smoke` is the guard: it imports the built package and reads a real file, so a build
that emits an unusable artifact fails at the build. It is checked against the actual broken
binary, not just the good one — the failure path is the part that matters.

Benchmarks deliberately do not run in CI. Shared runners are too noisy for the numbers to mean
anything.
