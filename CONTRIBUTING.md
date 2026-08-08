# Contributing

## What this project is

A thin binding. calamine does the parsing; this repo decides what the parsed
values look like on the JavaScript side and how one wasm binary reaches five
different runtimes. Almost every change belongs to one of those two areas, and
they have different rules — see [Changing cell behaviour](#changing-cell-behaviour)
and [Changing the packaging](#changing-the-packaging) below.

Bugs in the parser itself belong
[upstream](https://github.com/tafia/calamine/issues). If a file reads wrongly,
`cargo run --release --example dump_native -- path/to/file.xlsx` shows what
calamine returned before any of this crate's opinions were applied. If that dump
is already wrong, it is an upstream bug.

## Setting up

You need Rust, `wasm-pack`, and binaryen for `wasm-opt`.

```sh
rustup target add wasm32-unknown-unknown
brew install wasm-pack binaryen        # or your platform's equivalent

bun install
bun run build        # wasm-pack, then assembles dist/
bun run fixtures     # ~44 MB, fetched and generated, never committed
bun run test
```

The Rust version is pinned in `rust-toolchain.toml` and rustup will honour it
without being asked.

**binaryen must be 131 or newer.** Ubuntu still ships 108, from 2022, and that
`wasm-opt` mangles the externref table wasm-bindgen emits — producing a binary
that cannot instantiate at all, while the build still reports success. This cost
an afternoon once. `bun run smoke` catches it now, and says so in as many words,
but it is easier to just check `wasm-opt --version` first.

The test suites import `dist/`, not the crate. Rust changes are invisible to
them until you re-run `bun run build`.

## Before opening a pull request

```sh
bun run lint         # cargo fmt --check, clippy -D warnings
bun run typecheck    # tsc --noEmit, against the built dist/
bun run test         # cargo test, then node, then browser
```

`typecheck` needs `bun run build` to have run: it checks the test suites against
`dist/*.d.ts`, and those declarations are the thing being verified. A change to
`types/*.d.ts` that does not match the runtime fails there.

CI runs the same things plus a licence check. It builds the wasm once and shares
it across jobs, so the node and browser suites are always testing the same
binary — the alternative lets a difference between two compilations hide inside
a passing run.

## Changing cell behaviour

Anything touching `src/cells.rs`, `src/dates.rs` or `src/output.rs` changes what
a cell turns into, and that is the part with the most ways to be subtly wrong.

The rule: **the expectation has to be rebuilt in JavaScript, not asserted
against Rust.** `test/node/differential.test.ts` reads calamine's own corpus
through the native dumper, recomputes what the output should be in JS, and
compares against what the wasm produced. Checking our Rust against our Rust only
proves wasm behaves like the host. Rebuilding the mapping in a second language
means a bug has to be made twice, the same way, to escape — which is what caught
`"P"` and `"PT"` being parsed as zero-length durations instead of rejected. The
Rust unit tests had waved that through.

So a change here means:

1. A Rust unit test for the case.
2. The matching branch in the JS recomputation in `differential.test.ts`.
3. A fixture that actually reaches the branch, if the corpus does not.

Point 3 is not optional. The differential harness counts which cell types it
reached, because "no divergences" means nothing over code that never ran — the
first run scored 6 ISO datetimes and 2 ISO durations across all 130 upstream
files. `test/support/make-crafted-fixtures.ts` exists to fill those gaps and is
where a new one goes.

## Changing the packaging

The five entry points in `dist/` differ only in how the wasm bytes reach the
glue, which is the one thing every runtime does differently and the one thing
that breaks silently — a wrong relative path surfaces as a runtime error in
someone else's project, not here.

`test/node/entrypoints.test.ts` imports each entry in its own subprocess. Keep
it that way: the entries share one glue module, ES modules are singletons, and
importing two in one process lets the first initialise the second and hide a
broken loader. Same reason the browser suite gets a fresh page per test.

Two constraints that are easy to breach by accident:

- **No top-level await, anywhere in `dist/`.** It makes the package
  unrequirable from CJS and is contagious through bundlers. There is a test.
- **New runtime conditions go before the `import` fallback** in the `exports`
  map. Conditions match in order, so a fallback listed first wins over
  everything after it.

## Adding a runtime

Add a sibling directory under `test/` rather than threading a conditional
through an existing suite. `test/worker/README.md` sets out what a Cloudflare
Workers suite should prove and is the worked example — `dist/workerd.js` is
currently the one entry point nothing tests.

## Dependencies

A new Rust dependency ends up statically linked into the published `.wasm`, so
it brings a licence obligation with it. Run `bun run licenses` and commit the
regenerated `THIRD-PARTY-LICENSES.md`; CI fails if it drifts from `Cargo.lock`.
`accepted` in `about.toml` is an allowlist — anything copyleft fails the build
rather than being discovered after publishing.

Weigh the artifact size too. It is 370 KB gzipped and that number is in the
README, which makes it a promise.

## Commit messages

Present tense, describing what the change does — `Pin binaryen, and make a
broken build fail at the build`. The body is for why, and why is usually the
part worth writing down.
